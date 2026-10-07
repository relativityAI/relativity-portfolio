/**
 * skills/artifacts/xlsx — a dependency-free XLSX writer.
 *
 * A recipe is plain JSON stored with the analysis run, so the spreadsheet is
 * assembled on demand when the download route is hit — no file is ever written
 * to disk. An `.xlsx` file is an Office Open XML package: a ZIP of XML parts.
 * Node's zlib covers the deflate step, and the ZIP headers are written by hand
 * so the API does not need a spreadsheet library.
 */

import { deflateRawSync } from "node:zlib";
import type {
  Cell,
  CellFormat,
  CellInput,
  CellValue,
  ColumnSpec,
  SheetRecipe,
  WorkbookRecipe,
} from "./types.js";

// ---- style sheet ----------------------------------------------------------
// Indices into the cellXfs list below; kept in sync by hand because the parts
// are written as raw XML.
const STYLE_GENERAL = 0;
const STYLE_HEADER = 1;
const STYLE_WRAP = 2;
const STYLE_BOLD = 3;
const STYLE_NUMBER = 4;
const STYLE_INTEGER = 5;
const STYLE_CURRENCY = 6;
const STYLE_PERCENT = 7;
const STYLE_COUNT = 8;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0"/><numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${STYLE_COUNT}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function styleFor(format: CellFormat | undefined, wrap: boolean, bold: boolean): number {
  if (format === "currency") return STYLE_CURRENCY;
  if (format === "percent") return STYLE_PERCENT;
  if (format === "number") return STYLE_NUMBER;
  if (format === "integer") return STYLE_INTEGER;
  if (bold) return STYLE_BOLD;
  if (wrap) return STYLE_WRAP;
  return STYLE_GENERAL;
}

// ---- XML helpers ----------------------------------------------------------

/** Escapes text for an XML node or attribute and drops characters XML forbids. */
function xml(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function isCell(input: CellInput): input is Cell {
  return typeof input === "object" && input !== null;
}

function cellXml(ref: string, input: CellInput, column: ColumnSpec | undefined): string {
  const cell: Cell = isCell(input) ? input : { value: input };
  const bold = !!column?.bold;
  const wrap = !!column?.wrap;
  const format = cell.format ?? column?.format;

  if (cell.formula) {
    const formula = cell.formula.replace(/^=/, "");
    const style = styleFor(format, false, bold);
    let attrs = ` r="${ref}"${style ? ` s="${style}"` : ""}`;
    let body = `<f>${xml(formula)}</f>`;
    const cached = cell.cached;
    if (cached !== null && cached !== undefined) {
      if (typeof cached === "string") {
        attrs += ' t="str"';
        body += `<v>${xml(cached)}</v>`;
      } else if (typeof cached === "boolean") {
        attrs += ' t="b"';
        body += `<v>${cached ? 1 : 0}</v>`;
      } else if (Number.isFinite(cached)) {
        body += `<v>${cached}</v>`;
      }
    }
    return `<c${attrs}>${body}</c>`;
  }

  const value = cell.value;
  if (value === null || value === undefined) return "";

  if (typeof value === "boolean") {
    const style = styleFor(format, false, bold);
    return `<c r="${ref}"${style ? ` s="${style}"` : ""} t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const resolved = format ?? (Number.isInteger(value) ? "integer" : "number");
    const style = styleFor(resolved, false, bold);
    return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${value}</v></c>`;
  }

  const style = styleFor(format ?? "text", wrap, bold);
  const attrs = ` r="${ref}"${style ? ` s="${style}"` : ""}`;
  if (!value) return `<c${attrs} t="inlineStr"><is><t xml:space="preserve"/></is></c>`;
  return `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function rowXml(rowIndex: number, cells: CellInput[], columns: ColumnSpec[]): string {
  const parts: string[] = [];
  cells.forEach((cell, columnIndex) => {
    const xmlCell = cellXml(`${columnRef(columnIndex)}${rowIndex}`, cell, columns[columnIndex]);
    if (xmlCell) parts.push(xmlCell);
  });
  return `<row r="${rowIndex}">${parts.join("")}</row>`;
}

function sheetXml(sheet: SheetRecipe): string {
  const columns = sheet.columns ?? [];
  const hasHeader = columns.length > 0;
  const freeze = sheet.freezeHeader ?? hasHeader;

  const view = freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

  const cols = columns
    .map((column, index) =>
      column.width
        ? `<col min="${index + 1}" max="${index + 1}" width="${Math.min(255, Math.max(1, column.width))}" customWidth="1"/>`
        : "",
    )
    .join("");

  const header = hasHeader
    ? rowXml(1, columns.map((column) => column.label), columns)
    : "";
  const rows = sheet.rows.map((cells, index) => rowXml(index + (hasHeader ? 2 : 1), cells, columns));

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    view +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${header}${rows.join("")}</sheetData>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  );
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

/** Pack XML parts into a ZIP (deflate, UTF-8 names, no ZIP64 needed). */
function zip(entries: { name: string; xml: string }[]): Buffer {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

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
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
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
    directory.writeUInt16LE(dosTime, 12);
    directory.writeUInt16LE(dosDate, 14);
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

/** Excel rejects duplicate or illegal tab names; recipes come from storage. */
function normalizeSheets(sheets: SheetRecipe[]): SheetRecipe[] {
  const source = sheets.length ? sheets : [{ name: "Sheet1", rows: [] }];
  const taken = new Set<string>();
  return source.map((sheet, index) => {
    const base = String(sheet.name ?? "")
      .replace(/[\\/?*[\]:]/g, "-")
      .trim()
      .slice(0, 31)
      .trim() || `Sheet${index + 1}`;
    let name = base;
    for (let attempt = 2; taken.has(name.toLowerCase()); attempt++) {
      const suffix = ` ${attempt}`;
      name = `${base.slice(0, 31 - suffix.length).trimEnd()}${suffix}`;
    }
    taken.add(name.toLowerCase());
    return { ...sheet, name };
  });
}

function buildXlsx(recipe: WorkbookRecipe): Buffer {
  const sheets = normalizeSheets(recipe.sheets);
  const title = recipe.title || recipe.filename || "Workbook";
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

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
        `<dc:title>${xml(title)}</dc:title><dc:creator>Relativity</dc:creator>` +
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
          .map(
            (sheet, index) =>
              `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
          )
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
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      xml: sheetXml(sheet),
    })),
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
