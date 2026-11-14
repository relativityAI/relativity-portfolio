/**
 * skills/artifacts/xlsx — a dependency-free XLSX writer for the ref-based recipe.
 *
 * A recipe is plain JSON stored with the analysis run; the spreadsheet is
 * assembled on demand when the download route is hit — no file is ever written
 * to disk. An `.xlsx` file is an Office Open XML package: a ZIP of XML parts.
 * Node's zlib covers the deflate step and the ZIP headers are written by hand,
 * so the API does not need a spreadsheet library. Assembly is deterministic
 * (fixed dates) so the same recipe always yields the same bytes.
 */

import { deflateRawSync } from "node:zlib";
import type { RecipeCell, RecipeSheet, WorkbookRecipe } from "./types.js";

// ---- style sheet ----------------------------------------------------------
// Indices into the cellXfs list below; kept in sync by hand. There are two
// variants of each number format: plain, and the amber fill used for
// assumptions. General/plain is index 0 (the default).
const FORMATS: { id: number; code: string }[] = [
  { id: 164, code: "#,##0.00" },
  { id: 165, code: "#,##0" },
  { id: 166, code: "0.0%" },
  { id: 167, code: "0.0000" },
  { id: 168, code: "0" },
];
const STYLE_COUNT = FORMATS.length * 2 + 1;

/** Excel's own amber "assumption" highlight, asserted in test/artifacts.test.ts. */
const AMBER = "FFFFF2CC";

function styleIndex(numFmt: string | undefined, amber: boolean): number {
  const format = FORMATS.findIndex((f) => f.code === numFmt);
  // Index 0 is the unused default xf — ExcelJS treats s="0" as "no style", so
  // every real cell starts at 1.
  const base = format < 0 ? 1 : format + 1;
  return amber ? base + FORMATS.length : base;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="${FORMATS.length}">` +
  FORMATS.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${f.code}"/>`).join("") +
  `</numFmts>` +
  `<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${AMBER}"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="${STYLE_COUNT}">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  Array.from({ length: FORMATS.length * 2 }, (_, index) => {
    const amber = index >= FORMATS.length;
    const format = FORMATS[index % FORMATS.length];
    return `<xf numFmtId="${format.id}" fontId="0" fillId="${amber ? 2 : 0}" borderId="0" xfId="0"${amber ? " applyFill=\"1\"" : ""} applyNumberFormat="1"/>`;
  }).join("") +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// ---- XML helpers ----------------------------------------------------------

/** Escapes text for an XML node or attribute and drops characters XML forbids. */
function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `A` / `Z` / `AA` → 1-based column number. */
function columnFromRef(ref: string): number {
  let column = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) column = column * 26 + (ch.charCodeAt(0) - 64);
  return column;
}

function rowFromRef(ref: string): number {
  return Number(ref.replace(/^[A-Za-z]+/, "")) || 0;
}

/** 0-based column index to a reference like `A`, `Z`, `AA`. */
function columnRef(index: number): string {
  let remaining = index;
  let ref = "";
  do {
    ref = String.fromCharCode(65 + (remaining % 26)) + ref;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return ref;
}

function cellXml(cell: RecipeCell): string {
  const style = styleIndex(cell.numFmt, cell.provenance === "assumption");
  const attrs = ` r="${cell.ref}" s="${style}"`;

  if (cell.formula) {
    let body = `<f>${xml(cell.formula.replace(/^=/, ""))}</f>`;
    const result = cell.result;
    if (result === null || result === undefined) {
      // No cached value — Excel recalcs on open.
    } else if (typeof result === "string") {
      body += `<v>${xml(result)}</v>`;
      return `<c${attrs} t="str">${body}</c>`;
    } else if (typeof result === "boolean") {
      body += `<v>${result ? 1 : 0}</v>`;
      return `<c${attrs} t="b">${body}</c>`;
    } else if (Number.isFinite(result)) {
      body += `<v>${result}</v>`;
    }
    return `<c${attrs}>${body}</c>`;
  }

  const value = cell.value;
  if (value === null || value === undefined) return "";

  if (typeof value === "boolean") {
    return `<c${attrs} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return `<c${attrs}><v>${value}</v></c>`;
  }
  if (!value && value !== "") return "";
  if (value === "") return `<c${attrs} t="inlineStr"><is><t xml:space="preserve"/></is></c>`;
  return `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function rowsXml(cells: RecipeCell[]): string {
  const sorted = [...cells]
    .filter((cell) => cell.formula || cell.value !== null && cell.value !== undefined)
    .sort((a, b) => rowFromRef(a.ref) - rowFromRef(b.ref) || columnFromRef(a.ref) - columnFromRef(b.ref));
  const byRow = new Map<number, RecipeCell[]>();
  for (const cell of sorted) {
    const row = rowFromRef(cell.ref);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row)!.push(cell);
  }
  let out = "";
  for (const [row, cellsInRow] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const parts = cellsInRow
      .sort((a, b) => columnFromRef(a.ref) - columnFromRef(b.ref))
      .map(cellXml)
      .join("");
    if (parts) out += `<row r="${row}">${parts}</row>`;
  }
  return out;
}

function sheetXml(sheet: RecipeSheet): string {
  const cols = Object.entries(sheet.colWidths ?? {})
    .map(([letter, width]) => {
      const index = [...letter.toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
      return `<col min="${index}" max="${index}" width="${Math.min(255, Math.max(1, width))}" customWidth="1"/>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${rowsXml(sheet.cells)}</sheetData>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  );
}

/** Notes become Excel comments so the "why" travels with the cell. */
function commentsXml(sheet: RecipeSheet, author: string): string {
  const noted = sheet.cells.filter((c) => c.note);
  if (!noted.length) return "";
  const rows = noted.map(
    (cell, i) =>
      `<comment ref="${cell.ref}" authorId="0"><text><t>${xml(cell.note!)}</t></text></comment>` +
      (i < noted.length - 1 ? "" : ""),
  );
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<authors><author>${xml(author)}</author></authors>` +
    `<commentList>${rows.join("")}</commentList>` +
    `</comments>`
  );
}

export function safeSheetName(raw: string | undefined, index: number): string {
  const cleaned = String(raw ?? "")
    .replace(/[\\/?*]/g, " ")
    .replace(/[\[\]:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31)
    .trim();
  return cleaned || `Sheet${index + 1}`;
}

// ---- ZIP container --------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = -1;
  for (let index = 0; index < data.length; index++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/** Fixed timestamp so the same recipe always zips to the same bytes. */
const EPOCH = new Date(946684800000); // 2000-01-01T00:00:00Z
const DOS_TIME = (EPOCH.getHours() << 11) | (EPOCH.getMinutes() << 5) | (EPOCH.getSeconds() >> 1);
const DOS_DATE = ((EPOCH.getFullYear() - 1980) << 9) | ((EPOCH.getMonth() + 1) << 5) | EPOCH.getDate();

/** Pack XML parts into a ZIP (deflate, UTF-8 names, no ZIP64 needed). */
function zip(entries: { name: string; xml: string }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.from(entry.xml, "utf8");
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const name = Buffer.from(entry.name, "utf8");

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // names are UTF-8
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, payload);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(useDeflate ? 8 : 0, 10);
    directory.writeUInt16LE(DOS_TIME, 12);
    directory.writeUInt16LE(DOS_DATE, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(payload.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);

    offset += header.length + name.length + payload.length;
  }

  const centralDirectory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...local, centralDirectory, end]);
}

// ---- package parts --------------------------------------------------------

function buildXlsx(recipe: WorkbookRecipe): Buffer {
  const taken = new Set<string>();
  const sheets = recipe.sheets.map((sheet, i) => {
    let name = safeSheetName(sheet.name, i);
    for (let attempt = 2; taken.has(name.toLowerCase()); attempt++) {
      const suffix = ` ${attempt}`;
      name = `${safeSheetName(sheet.name, i).slice(0, 31 - suffix.length).trimEnd()}${suffix}`;
    }
    taken.add(name.toLowerCase());
    return { ...sheet, name };
  });

  const title = recipe.description || recipe.filename || "Workbook";
  const timestamp = `${EPOCH.toISOString().replace(/\.\d{3}Z$/, "Z")}`;
  const author = "Relativity";
  const comments = sheets.map((sheet) => commentsXml(sheet, author));

  const entries: { name: string; xml: string }[] = [
    {
      name: "[Content_Types].xml",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        sheets
          .map(
            (_sheet, index) =>
              `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        comments
          .map(
            (xmlContent, index) =>
              xmlContent &&
              `<Override PartName="/xl/comments${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`,
          )
          .join("") +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
        `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
        `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "docProps/core.xml",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
        `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
        `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>` +
        `</cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
        `<Application>Relativity</Application></Properties>`,
    },
    {
      name: "xl/workbook.xml",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        sheets
          .map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
          .join("") +
        `</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets
          .map(
            (_sheet, index) =>
              `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: "xl/styles.xml", xml: STYLES_XML },
    ...sheets.flatMap((sheet, index) => {
      const parts: { name: string; xml: string }[] = [
        { name: `xl/worksheets/sheet${index + 1}.xml`, xml: sheetXml(sheet) },
      ];
      const sheetWithComments = comments[index];
      if (sheetWithComments) {
        parts.push({ name: `xl/comments${index + 1}.xml`, xml: sheetWithComments });
        // Each commented worksheet links its comments part so readers find it.
        // ExcelJS only discovers parts named xl/comments<N>.xml (see xlsx.js).
        parts.push({
          name: `xl/worksheets/_rels/sheet${index + 1}.xml.rels`,
          xml:
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments${index + 1}.xml"/>` +
            `</Relationships>`,
        });
        // ponytail: no VML legacy drawing — comment markers won't render in
        // Excel's UI, only the data. Add the vmlDrawing part if users ask.
      }
      return parts;
    }),
  ];

  return zip(entries);
}

/**
 * Build the `.xlsx` binary for a stored recipe. Async so the download route
 * can grow a real pipeline (or a worker) without changing its call site.
 */
export async function renderXlsx(recipe: WorkbookRecipe): Promise<Buffer> {
  return buildXlsx(recipe);
}