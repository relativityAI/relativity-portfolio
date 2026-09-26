// Server-side PDF report generation.
//
// Report plots are drawn to static SVG (mirroring the UI's chart styling and
// colour palette), rasterized to PNG (resvg), and embedded in a pdfmake
// document — so the PDF carries the same charts the UI shows, as vector-first
// images, not a screen capture. Recharts itself cannot run under SSR, so the
// plot primitives are drawn natively here.

import { Resvg } from "@resvg/resvg-js";
import { createRequire } from "node:module";
import type { ReportBlock } from "./agent.js";
import { log } from "./logger.js";
import { agentChipPng, agentSeed, providerChipPng } from "./agentIdentity.js";
import { LOGO_PNG_DATA_URI } from "./reportLogo.js";

// pdfmake ships a CJS browser build that Vite's transformer breaks. Load it via
// Node's native require (identical in tsc-runtime and vitest).
const nodeRequire = createRequire(import.meta.url);
const pdfMakeModule: any = nodeRequire("pdfmake/build/pdfmake.js");
const pdfFontsModule: any = nodeRequire("pdfmake/build/vfs_fonts.js");
const pdfMake: any = pdfMakeModule;
const pdfFonts: any = pdfFontsModule;

type PdfNode = any;
type PdfContent = PdfNode[];

type ChartBlock = Extract<ReportBlock, { type: "chart" }>;
type Datum = Record<string, number | string>;

// Mirrors the palette/labels ReportBlockRenderer.tsx uses in the UI.
const CHART_COLORS = ["#5B7FDE", "#4C8B6B", "#B8935A", "#8FA0C8", "#B85C5C"];
const GRID = "#D9D9D5";
const AXIS = "#9CA3AF";
const AXIS_S = "#6B7280";
const W = 620;
const H = 320;
const M = { top: 34, right: 14, bottom: 44, left: 52 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function nice(max: number): number {
  const raw = max * 1.05;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function fmtTick(v: number): string {
  if (Math.abs(v) >= 1000) return String(Math.round(v));
  if (Number.isInteger(Math.round(v * 100) / 100)) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}

function legendSvg(items: { key: string; color: string; kind: "rect" | "line" }[]): string {
  let px = 14; // recharts legend sits at the top of the wrapper
  const parts = items.map((it, i) => {
    const x = px;
    const y = 18;
    px += (it.kind === "line" ? 4 : 2) + it.key.length * 6.2 + 14;
    const marker = it.kind === "line" ? `<line x1="${x}" y1="${y + 1}" x2="${x + 12}" y2="${y + 1}" stroke="${it.color}" stroke-width="2"/><circle cx="${x + 6}" cy="${y + 1}" r="3" fill="${it.color}"/>` : `<rect x="${x}" y="${y - 5}" width="10" height="10" rx="2" fill="${it.color}"/>`;
    return `${marker}<text x="${x + 16}" y="${y + 3}" font-size="11" fill="${AXIS_S}">${esc(it.key)}</text>`;
  });
  return `<g>${parts.join("")}</g>`;
}

function getData(block: ChartBlock): { data: Datum[]; keys: string[]; xKey: string } {
  const data = (block.data || []) as Datum[];
  const first = data[0] || {};
  const keys = Object.keys(first).filter((k) => k !== "name" && k !== "label");
  const xKey = Object.prototype.hasOwnProperty.call(first, "name") ? "name" : Object.prototype.hasOwnProperty.call(first, "label") ? "label" : Object.keys(first)[0] || "name";
  return { data, keys, xKey };
}

function barLineAreaSvg(block: ChartBlock): string {
  const { data, keys, xKey } = getData(block);
  const values = data.flatMap((d) => keys.map((k) => Number(d[k] ?? NaN))).filter((v) => Number.isFinite(v));
  const maxV = values.length ? Math.max(...values) : 1;
  const minV = values.length && Math.min(...values) <= 0 ? Math.min(...values) : 0;
  const yMax = nice(maxV - minV) + minV;
  const y = (v: number) => M.top + PH - ((v - minV) / (yMax - minV)) * PH;
  const ticks = Array.from({ length: 5 }, (_, i) => minV + ((yMax - minV) / 4) * i);
  const grid = ticks
    .map((t) => {
      const yy = y(t);
      return `<line x1="${M.left}" y1="${yy}" x2="${W - M.right}" y2="${yy}" stroke="${GRID}" stroke-dasharray="3 3"/><text x="${M.left - 8}" y="${yy + 3}" font-size="11" fill="${AXIS}" text-anchor="end">${fmtTick(t)}</text>`;
    })
    .join("");
  const band = PW / Math.max(data.length, 1);
  const xLabels = data
    .map((d, i) => `<text x="${M.left + band * i + band / 2}" y="${H - 30}" font-size="11" fill="${AXIS}" text-anchor="middle">${esc(String(d[xKey]))}</text>`)
    .join("");

  let series = "";
  if (block.chartType === "bar") {
    const groupW = Math.min(band * 0.62, 56);
    const barW = groupW / keys.length;
    for (let i = 0; i < keys.length; i++) {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      series += data
        .map((d, j) => {
          const v = Number(d[keys[i]] ?? NaN);
          if (!Number.isFinite(v)) return "";
          const cx = M.left + band * j + band / 2 - groupW / 2 + barW * i;
          const bH = Math.max(1, Math.abs(y(v) - y(minV)));
          const top = v >= minV ? y(v) : y(minV);
          return `<path d="M${cx},${top + bH} V${top + 2} Q${cx},${top} ${cx + 2},${top} H${cx + barW - 2} Q${cx + barW},${top} ${cx + barW},${top + 2} V${top + bH} Z" fill="${color}"/>`;
        })
        .join("");
    }
  } else {
    const smooth = (pts: { x: number; y: number }[]) => {
      let d = `M${pts[0].x},${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const xm = (pts[i].x + pts[i + 1].x) / 2;
        d += ` Q${pts[i].x},${pts[i].y} ${xm},${(pts[i].y + pts[i + 1].y) / 2}`;
        d += ` T${pts[i + 1].x},${pts[i + 1].y}`;
      }
      return d;
    };
    for (let i = 0; i < keys.length; i++) {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      const pts = data
        .map((d, j) => ({ x: M.left + band * j + band / 2, y: y(Number(d[keys[i]])) }))
        .filter((p) => Number.isFinite(p.y));
      if (pts.length < 2) continue;
      const line = smooth(pts);
      const area = block.chartType === "area" ? `${line} L${pts[pts.length - 1].x},${y(minV)} L${pts[0].x},${y(minV)} Z` : "";
      if (area) series += `<path d="${area}" fill="${color}" fill-opacity="0.3"/>`;
      series += `<path d="${line}" fill="none" stroke="${color}" stroke-width="2"/>`;
      series += pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${color}"/>`).join("");
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif"><g>${legendSvg(keys.map((k, i) => ({ key: k, color: CHART_COLORS[i % CHART_COLORS.length], kind: block.chartType === "bar" ? "rect" : "line" })))}</g>${grid}${xLabels}${series}</svg>`;
}

function scatterSvg(block: ChartBlock): string {
  const { data, keys, xKey } = getData(block);
  const yKey = keys[0] || "value";
  const xs = data.map((d) => Number(d[xKey])).filter(Number.isFinite);
  const ys = data.map((d) => Number(d[yKey])).filter(Number.isFinite);
  const minX = Math.min(0, ...xs);
  const maxX = nice(Math.max(...xs, 1));
  const minY = Math.min(0, ...ys);
  const maxY = nice(Math.max(...ys, 1));
  const x = (v: number) => M.left + ((v - minX) / (maxX - minX)) * PW;
  const y = (v: number) => M.top + PH - ((v - minY) / (maxY - minY)) * PH;
  const ticksX = Array.from({ length: 5 }, (_, i) => minX + ((maxX - minX) / 4) * i);
  const ticksY = Array.from({ length: 5 }, (_, i) => minY + ((maxY - minY) / 4) * i);
  const grid =
    ticksY.map((t) => `<line x1="${M.left}" y1="${y(t)}" x2="${W - M.right}" y2="${y(t)}" stroke="${GRID}" stroke-dasharray="3 3"/><text x="${M.left - 8}" y="${y(t) + 3}" font-size="11" fill="${AXIS}" text-anchor="end">${fmtTick(t)}</text>`).join("") +
    ticksX.map((t) => `<text x="${x(t)}" y="${H - 30}" font-size="11" fill="${AXIS}" text-anchor="middle">${fmtTick(t)}</text>`).join("");
  const dots = data
    .map((d) => {
      const dx = Number(d[xKey]);
      const dy = Number(d[yKey]);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return "";
      return `<circle cx="${x(dx)}" cy="${y(dy)}" r="5" fill="${CHART_COLORS[0]}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif"><g>${legendSvg([{ key: "Data", color: CHART_COLORS[0], kind: "line" }])}</g>${grid}${dots}</svg>`;
}

function radarSvg(block: ChartBlock): string {
  const { data, keys, xKey } = getData(block);
  const values = data.flatMap((d) => keys.map((k) => Number(d[k] ?? NaN))).filter(Number.isFinite);
  const maxV = nice(values.length ? Math.max(...values) : 1);
  const cx = M.left + PW / 2;
  const cy = M.top + PH / 2;
  const R = Math.min(PW, PH) / 2 - 30;
  const angle = (i: number) => ((Math.PI * 2 * i) / data.length) - Math.PI / 2;
  const px = (i: number, r: number) => cx + Math.cos(angle(i)) * r;
  const py = (i: number, r: number) => cy + Math.sin(angle(i)) * r;
  const ring = (r: number) => data.map((_, i) => `${px(i, r)},${py(i, r)}`).join(" ");
  const grid =
    Array.from({ length: 4 }, (_, idx) => `<polygon points="${ring(R * ((idx + 1) / 4))}" fill="none" stroke="${GRID}" stroke-dasharray="${idx === 3 ? "" : "3 3"}"/>`).join("") +
    data.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${px(i, R)}" y2="${py(i, R)}" stroke="${GRID}"/>`).join("") +
    data.map((d, i) => {
      const tx = px(i, R + 20);
      const ty = py(i, R + 20);
      return `<text x="${tx}" y="${ty + 3}" font-size="10" fill="${AXIS_S}" text-anchor="middle">${esc(String(d[xKey]))}</text>`;
    }).join("") +
    [0.25, 0.5, 0.75, 1].map((f) => `<text x="${cx + Math.cos(angle(0)) * R * f + 4}" y="${cy + Math.sin(angle(0)) * R * f + 3}" font-size="9" fill="${AXIS}">${fmtTick(maxV * f)}</text>`).join("");

  const polys = keys
    .map((k, i) => {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      const pts = data
        .map((d, j) => `${px(j, (Number(d[k]) / maxV) * R)},${py(j, (Number(d[k]) / maxV) * R)}`)
        .join(" ");
      return `<polygon points="${pts}" fill="${color}" fill-opacity="0.4" stroke="${color}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif"><g>${legendSvg(keys.map((k, i) => ({ key: k, color: CHART_COLORS[i % CHART_COLORS.length], kind: "line" })))}</g>${grid}${polys}</svg>`;
}

function pieSvg(block: ChartBlock): string {
  const { data, keys, xKey } = getData(block);
  const key = keys[0] ?? "value";
  const slices = data
    .map((d) => ({ name: String(d[xKey] ?? ""), value: Number(d[key]) }))
    .filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"></svg>`;
  const cx = 180;
  const cy = M.top + PH / 2 + 8;
  const r = Math.min(PH / 2 - 14, 116);
  let a0 = 0;
  const arcs = slices.map((s, i) => {
    const a1 = a0 + (s.value / total) * 2 * Math.PI;
    const p0 = a0 - Math.PI / 2;
    const p1 = a1 - Math.PI / 2;
    const x0 = cx + r * Math.cos(p0);
    const y0 = cy + r * Math.sin(p0);
    const x1 = cx + r * Math.cos(p1);
    const y1 = cy + r * Math.sin(p1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const path = `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
    a0 = a1;
    return `<path d="${path}" fill="${color}" stroke="#FFFFFF" stroke-width="2"/>`;
  }).join("");
  const legend = slices
    .map((s, i) => {
      const y = M.top + 12 + i * 20;
      const pct = Math.round((s.value / total) * 100);
      return `<rect x="330" y="${y - 8}" width="10" height="10" rx="2" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/><text x="348" y="${y}" font-size="11" fill="${AXIS_S}">${esc(`${s.name} — ${pct}%`)}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">${arcs}${legend}</svg>`;
}

/** Draw a chart report block as SVG, mirroring the UI's chart styling. */
export function renderChartSvg(block: ChartBlock): string {
  switch (block.chartType) {
    case "bar":
    case "line":
    case "area":
      return barLineAreaSvg(block);
    case "scatter":
      return scatterSvg(block);
    case "radar":
      return radarSvg(block);
    case "pie":
      return pieSvg(block);
    default:
      return "";
  }
}

/** Render a chart report block to a PNG buffer (2x for print sharpness). */
export function chartBlockToPng(block: ChartBlock): Buffer {
  const svg = renderChartSvg(block);
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1400 } });
  return Buffer.from(resvg.render().asPng());
}

/** Strip the light markdown the model uses (###, **, bullets) to plain PDF text. */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
function plain(text: string): string {
  return String(text || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(UUID_RE, "")
    .trim();
}

function signalColor(score: number | null | undefined): string {
  if (score == null) return "#9CA3AF";
  if (score >= 70) return "#4C8B6B";
  if (score >= 40) return "#B8935A";
  return "#B85C5C";
}

function fmt(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v ?? "—");
}

function markdownText(md: string): string[] {
  const parts: string[] = [];
  for (const line of String(md || "").split("\n")) {
    const t = plain(line);
    if (!t) continue;
    if (/^\s*[-*•]/.test(line)) parts.push(`•  ${t.replace(/^\s*[-*•]\s*/, "")}`);
    else parts.push(t);
  }
  return parts;
}

/** Map metric/parameter names to a one-line data-point description for evidence captions. */
function evidenceLookupFor(run: any): Record<string, string> {
  const m: Record<string, string> = {};
  const sym: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", between: "between" };
  for (const [k, d] of Object.entries(run.quantitative_analysis || {})) {
    const e = d as any;
    const label = e.metric_name || k;
    const rule = `${sym[e.operator] || "="} ${e.threshold ?? "—"}`;
    const line = e.price_unavailable
      ? `${label} → N/A (no live price)`
      : `${label} ${rule} → ${e.value ?? "—"} · score ${Math.round((e.score ?? 0) * 10) / 10}`;
    m[k] = line;
    m[label] = line;
  }
  for (const [k, p] of Object.entries(run.qualitative_analysis || {})) {
    m[k] = `score ${Math.round(((p as any).score ?? 0) * 10) / 10}`;
  }
  return m;
}

/** Evidence caption under a block that claims to be backed by named data points. */
function evidenceLine(keys: string[] | undefined, lookup: Record<string, string>): PdfContent {
  // Drop infrastructure ids (uuid-shaped keys) — they are never human-facing
  // data points and leak internal row ids into the report.
  const resolved = (keys || []).filter((k) => k !== "scored_data" && !UUID_RE.test(k));
  if (resolved.length === 0) return [];
  return [{ text: `Based on: ${resolved.map((k) => lookup[k] ?? k).join(" · ")}`, style: "meta", margin: [0, 1, 0, 5] }];
}

async function blockToPdfContent(block: ReportBlock, lookup: Record<string, string>): Promise<PdfContent> {
  switch (block.type) {
    case "heading":
      return [{ text: plain(block.text), style: block.level === 2 ? "h2" : "h3" }];
    case "paragraph": {
      return [
        ...markdownText(block.text).map((ln) => ({ text: ln, style: "body" })),
        ...evidenceLine(block.citedKeys, lookup),
      ];
    }
    case "callout": {
      const colors: Record<string, string> = { positive: "#E9F2EC", caution: "#F6EFDC", negative: "#F7E9E9", neutral: "#F4F4F3" };
      const textColors: Record<string, string> = { positive: "#2F6B47", caution: "#7A5A1F", negative: "#943F3F", neutral: "#4B5563" };
      return [
        {
          text: plain(block.text),
          style: "callout",
          background: colors[block.tone] || colors.neutral,
          color: textColors[block.tone] || textColors.neutral,
        },
      ];
    }
    case "quote":
      return [{ text: `“${plain(block.text)}”${block.attribution ? `  — ${plain(block.attribution)}` : ""}`, style: "quote" }];
    case "table": {
      const rows = (block.rows || []).map((r) => r.map((c) => ({ text: fmt(c), style: "cell" })));
      return [
        block.title ? { text: plain(block.title), style: "tableTitle" } : {},
        {
          table: {
            headerRows: 1,
            widths: block.columns.map(() => "*"),
            body: [
              block.columns.map((c) => ({ text: plain(c), style: "cellHeader" })),
              ...rows,
            ],
          },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            fillColor: (rowIdx: number) => (rowIdx === 0 ? "#F4F4F3" : rowIdx % 2 ? "#FAFAF9" : "#FFFFFF"),
            paddingTop: () => 5,
            paddingBottom: () => 5,
            paddingLeft: () => 6,
            paddingRight: () => 6,
          },
          margin: [0, 4, 0, 10],
        },
        ...evidenceLine(block.sourceKeys, lookup),
      ];
    }
    case "chart": {
      try {
        const png = chartBlockToPng(block);
        return [
          block.title ? { text: plain(block.title), style: "tableTitle" } : {},
          { image: `data:image/png;base64,${png.toString("base64")}`, width: 500, margin: [0, 4, 0, 12], alignment: "center" },
          ...evidenceLine(block.sourceKeys, lookup),
        ];
      } catch (e: any) {
        log.warn("[pdf]", `chart render failed, skipped: ${e?.message || e}`);
        return [{ text: `[Chart not rendered: ${block.title || "plot"}]`, style: "cell" }];
      }
    }
    default:
      return [];
  }
}

/**
 * The "Prepared for …" meta line, fronted by the agent's identity chip
 * (sepia portrait on its colour) and, when a model is set, the provider's
 * monogram chip. Degrades to the plain text line if rasterization fails.
 */
function identityTitleBand(run: any): PdfNode {
  const plainLine =
    `Prepared for the "${run.agent_name || "Agent"}" mandate` +
    (run.model ? ` · ${run.model}` : "") +
    ` · ${run.created_at ? new Date(run.created_at).toLocaleDateString() : ""}`;
  try {
    return {
      columns: [
        {
          image: `data:image/png;base64,${agentChipPng(agentSeed(run.agent_name || "Agent")).toString("base64")}`,
          width: 30,
          height: 30,
          margin: [0, 0, 12, 0],
        },
        {
          stack: [
            { text: `Prepared for the "${run.agent_name || "Agent"}" mandate`, style: "meta" },
            run.model
              ? {
                  columns: [
                    {
                      image: `data:image/png;base64,${providerChipPng(run.model).toString("base64")}`,
                      width: 12,
                      height: 12,
                      margin: [0, 1, 6, 0],
                    },
                    {
                      text: `${run.model} · ${run.created_at ? new Date(run.created_at).toLocaleDateString() : ""}`,
                      style: "meta",
                    },
                  ],
                  margin: [0, 2, 0, 0],
                }
              : { text: run.created_at ? new Date(run.created_at).toLocaleDateString() : "", style: "meta" },
          ],
        },
      ],
      margin: [0, 8, 0, 2],
    };
  } catch (e: any) {
    log.warn("[pdf]", `identity chips skipped: ${e?.message || e}`);
    return { text: plainLine, style: "meta" };
  }
}

/** Assemble the full PDF document definition for a completed run. */
export async function buildReportPdf(run: any): Promise<Buffer> {
  pdfMake.vfs = pdfFonts?.pdfMake?.vfs ?? pdfFonts ?? {};
  const report = run.report || {};
  const blocks: ReportBlock[] = Array.isArray(report.blocks) ? report.blocks : [];
  const total = run.total_score;
  const quant = run.quantitative_score;
  const qual = run.qualitative_score;
  const document: any = {
    pageSize: "A4",
    pageMargins: [44, 46, 44, 60],
    info: { title: `${run.share_name || run.symbol || "Analysis"} — Equity Report`, author: "Relativity" },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          image: LOGO_PNG_DATA_URI,
          width: 17,
          height: 13,
          margin: [0, 1, 0, 0],
        },
        { text: `Relativity · ${run.share_name || run.symbol} · ${run.agent_name || "Agent"}`, style: "footer", alignment: "left", margin: [0, 3, 0, 0] },
        { text: `page ${currentPage} of ${pageCount}`, style: "footer", alignment: "right", margin: [0, 3, 0, 0] },
      ],
      columnGap: 6,
      margin: [44, 20, 44, 0],
    }),
    content: [
      // ── Title band ──
      // Brand mark alone on top, stock name and details stacked below it.
      {
        image: LOGO_PNG_DATA_URI,
        width: 34,
        height: 26,
        margin: [0, 0, 0, 10],
      },
      { text: run.share_name || run.symbol || "Equity Analysis", style: "title" },
      { text: `${run.symbol || ""}${run.source ? ` · ${run.source}` : ""}`, style: "subtitle", margin: [0, 2, 0, 10] },
      identityTitleBand(run),
      { text: "", style: "spacer" },
      // ── Hero band ──
      {
        table: {
          headerRows: 0,
          widths: ["*", "*", "*"],
          body: [
            [
              { text: `${total ?? "—"}`, style: "hero", color: signalColor(total), alignment: "center" },
              { text: `${quant ?? "—"}`, style: "hero", color: signalColor(quant), alignment: "center" },
              { text: `${qual ?? "—"}`, style: "hero", color: signalColor(qual), alignment: "center" },
            ],
            [
              { text: "Overall alignment", style: "heroLabel", alignment: "center" },
              { text: "Quantitative", style: "heroLabel", alignment: "center" },
              { text: "Qualitative", style: "heroLabel", alignment: "center" },
            ],
          ],
        },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => "#FAFAF9" },
        margin: [0, 4, 0, 18],
      },
      report.partial
        ? { text: "Partial result — some qualitative parameters failed to score; this report reflects partial data.", style: "callout", background: "#F6EFDC", color: "#7A5A1F" }
        : {},
    ],
    styles: {
      title: { fontSize: 26, bold: true, color: "#16181B" },
      subtitle: { fontSize: 12, color: "#6B7280", fontFeatures: ["tnum"] },
      meta: { fontSize: 9, color: "#9CA3AF", margin: [0, 2, 0, 0] },
      spacer: { fontSize: 6 },
      hero: { fontSize: 30, bold: true, color: "#16181B" },
      heroLabel: { fontSize: 9, color: "#9CA3AF", margin: [0, -6, 0, 8] },
      h2: { fontSize: 14, bold: true, color: "#16181B", margin: [0, 16, 0, 6] },
      h3: { fontSize: 11, bold: true, color: "#4B5563", margin: [0, 10, 0, 3] },
      body: { fontSize: 9.5, color: "#4B5563", lineHeight: 1.45, margin: [0, 2, 0, 4] },
      callout: { fontSize: 9.5, margin: [10, 6, 10, 6], color: "#4B5563" },
      quote: { fontSize: 10, italics: true, color: "#4B5563", margin: [0, 4, 0, 6] },
      tableTitle: { fontSize: 9.5, bold: true, color: "#4B5563", margin: [0, 6, 0, 2] },
      cellHeader: { fontSize: 8.5, bold: true, color: "#6B7280", fontFeatures: ["smcp"], margin: [0, 1] },
      cell: { fontSize: 8.5, color: "#16181B", margin: [0, 1] },
      risks: { fontSize: 9, color: "#7A5A1F", margin: [0, 2, 0, 4] },
      footer: { fontSize: 7.5, color: "#9CA3AF" },
    },
  };

  for (const block of blocks) {
    const node = await blockToPdfContent(block, evidenceLookupFor(run));
    for (const n of node) document.content.push(n);
  }

  const pdf: any = pdfMake;
  const doc = pdf.createPdf(document);
  return new Promise<Buffer>((resolve, reject) => {
    doc.getBuffer((buf: Buffer) => resolve(Buffer.from(buf)), (err: Error) => reject(err));
  });
}