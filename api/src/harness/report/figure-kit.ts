/**
 * figure-kit — the report's server-side figure renderer. Port of the skill's
 * assets/chart-kit.js (pure string builders) with the Almanac drawing rules
 * baked in: one story ink (var(--c)), direct labels instead of legends,
 * honest scales (bars from zero; line scales stop at the data), real minus,
 * one scale word per axis.
 *
 * Every colour and size is an INLINE style carrying a var() fallback, so one
 * string works twice: it follows the app theme inside `.almanac-report` AND
 * stands alone in the raw markdown export (fallback = light palette). No DOM,
 * no animation (motion is a garnish — the JS kit's draw-in/anno animations
 * are deliberately not ported).
 */
import type { ChartSpec, Series } from "./document.js";

const MINUS = "\u2212"; // real minus, per the number-typesetting rule
const C = {
  // fallbacks live INSIDE var() — a bare var(--x) with no default invalidates
  // the whole declaration outside the app (md export/preview), silently
  // inheriting the body font instead of Anek/Newsreader.
  sans: "var(--font-body,'Anek Latin',system-ui,sans-serif)",
  serif: "var(--font-display,'Newsreader',Georgia,serif)",
  bg: "var(--bg,#FAFAF9)",
  c: "var(--c,#3A5BD0)",
  ink: "var(--ink,#16181B)",
  mid: "var(--mid,#5A6270)",
  dim: "var(--dim,#6B7280)",
  grid: "var(--line,#C7C7C2)",
  slate: "var(--slate,#b7b7bf)",
  onC: "var(--on-c,#ffffff)",
  // signed-number inks — same pair almanac.css uses for table .pos/.neg
  pos: "var(--economy-ink,#2A45A8)",
  neg: "var(--people-ink,#A63C71)",
};

export interface FigureOpts {
  /** Artboard width — page figures draw at 1040 (skill rule: draw at the width you show). */
  w?: number;
  h?: number;
  /** Axis/label unit, drives the scale word (×, %, USD…) and ₹ grouping. */
  unit?: string;
  /** aria-label for the svg. */
  label?: string;
  /** Plot ink override (spec.color / skill palette); defaults to the theme story ink. */
  ink?: string;
}

const rr = (n: number) => Math.round(n * 100) / 100;
const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function txt(
  x: number,
  y: number,
  s: string,
  o: {
    anchor?: "start" | "middle" | "end";
    size?: number;
    weight?: number;
    fill?: string;
    serif?: boolean;
    italic?: boolean;
    /** ground-coloured halo where a label crosses lines (skill labelling rule). */
    halo?: boolean;
    /** Extra CSS bolted onto the inline style (tracking, tabular figures). */
    extra?: string;
  } = {},
): string {
  const style = [
    `font-family:${o.serif ? C.serif : C.sans}`,
    `font-size:${o.size ?? 11}px`,
    `font-weight:${o.weight ?? 400}`,
    `fill:${o.fill ?? C.mid}`,
    o.italic ? "font-style:italic" : "",
    o.halo ? `paint-order:stroke;stroke:${C.bg};stroke-width:3px;stroke-linejoin:round` : "",
    o.extra ?? "",
  ]
    .filter(Boolean)
    .join(";");
  return `<text x="${rr(x)}" y="${rr(y)}" text-anchor="${o.anchor ?? "start"}" style="${style}">${esc(s)}</text>`;
}

const rect = (x: number, y: number, w: number, h: number, fill: string, opacity?: number, rx = 0) =>
  `<rect x="${rr(x)}" y="${rr(y)}" width="${rr(Math.max(0, w))}" height="${rr(Math.max(0, h))}"${rx ? ` rx="${rx}"` : ""} style="fill:${fill}"${opacity != null ? ` opacity="${opacity}"` : ""}/>`;

const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, width = 1, dash?: string) =>
  `<line x1="${rr(x1)}" y1="${rr(y1)}" x2="${rr(x2)}" y2="${rr(y2)}" style="stroke:${stroke};stroke-width:${width}${dash ? `;stroke-dasharray:${dash}` : ""}"/>`;

const svgOpen = (w: number, h: number, label?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rr(w)} ${rr(h)}" width="${rr(w)}" height="${rr(h)}" role="img"${label ? ` aria-label="${esc(label)}"` : ""}>`;

/** Values → text: real minus, thousands grouping (lakh grouping for ₹), ≤2 decimals. */
export function fmtNum(v: number, unit = ""): string {
  if (!Number.isFinite(v)) return "";
  const rupee = unit.trim().startsWith("₹");
  const s = Math.abs(v).toLocaleString(rupee ? "en-IN" : "en-US", { maximumFractionDigits: 2 });
  return (v < 0 ? MINUS : "") + s;
}

/** Scale word from the axis magnitude: 5.1e12 → "T"; ₹ gets lakh/crore. */
function scaleOf(maxAbs: number, unit = ""): { div: number; word: string } {
  if (unit.trim().startsWith("₹")) {
    if (maxAbs >= 1e7) return { div: 1e7, word: " crore" };
    if (maxAbs >= 1e5) return { div: 1e5, word: " lakh" };
    return { div: 1, word: "" };
  }
  for (const [d, w] of [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ] as [number, string][]) {
    if (maxAbs >= d) return { div: d, word: w };
  }
  return { div: 1, word: "" };
}

/** One scale word per axis: every tick printed in the top tick's scale. */
function tickFmt(step: number, maxAbs: number, unit = ""): (v: number) => string {
  const { div, word } = scaleOf(maxAbs, unit);
  const s = step / div;
  const dec = s >= 1 ? 0 : s >= 0.1 ? 1 : 2;
  return (v) => {
    if (v === 0) return "0";
    const t = v / div;
    const body = (t < 0 ? MINUS : "") + Math.abs(t).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return body + word;
  };
}

/** Nice round tick ladder (1/2/5×10ⁿ) — honest axis, no 347.81 ticks. */
function niceTicks(lo: number, hi: number, count = 4): { lo: number; hi: number; step: number; ticks: number[] } {
  if (!(hi > lo)) hi = lo + Math.abs(lo || 1);
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  const nlo = Math.floor(lo / step) * step;
  const nhi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = nlo; v <= nhi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e9 ? 0 : v);
  return { lo: nlo, hi: nhi, step, ticks };
}

/** Smooth cubic path through the points (the kit's house curve). */
function smooth(pts: [number, number][]): string {
  if (!pts.length) return "";
  if (pts.length < 2) return `M ${rr(pts[0][0])} ${rr(pts[0][1])}`;
  let d = `M ${rr(pts[0][0])} ${rr(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i - 1][0] + pts[i][0]) / 2;
    d += ` C ${rr(cx)} ${rr(pts[i - 1][1])}, ${rr(cx)} ${rr(pts[i][1])}, ${rr(pts[i][0])} ${rr(pts[i][1])}`;
  }
  return d;
}

/**
 * Series → a shared x axis (union of timestamps) with constant-hold fill, so a
 * shorter series (sma200 tail) doesn't split the path.
 * ponytail: constant-hold across true gaps; null-split paths if divergence matters.
 */
function alignSeries(series: Series[]): { xs: number[]; xLabels: string[]; seriesLabels: string[]; data: number[][] } {
  const used = series.filter((s) => s.points.length);
  const set = new Set<number>();
  for (const s of used) for (const p of s.points) set.add(p.t);
  const xs = [...set].sort((a, b) => a - b);
  const data = used.map((s) => {
    const m = new Map(s.points.map((p) => [p.t, p.v]));
    const out: number[] = [];
    let last: number | undefined;
    for (const t of xs) {
      const v = m.get(t);
      if (v !== undefined) last = v;
      out.push(last ?? NaN);
    }
    // backfill leading holes from the first real value
    const first = out.find((v) => Number.isFinite(v));
    return out.map((v) => (Number.isFinite(v) ? v : (first ?? NaN)));
  });
  // drop series with no data at all (chart then draws whatever remains)
  const keep = data.map((d) => d.some(Number.isFinite));
  const seriesLabels = used.map((s, i) => (keep[i] ? s.label : "")).filter((_, i) => keep[i]);
  const keptData = data.filter((_, i) => keep[i]);
  // x labels: epoch → YYYY-MM-DD (points come from tool payloads as epoch seconds)
  const fmt = (t: number) => new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10);
  return { xs, xLabels: xs.map(fmt), seriesLabels, data: keptData };
}

/** Story ink: lead = plot ink, second = rival (ink), rest = context grey. */
const colorOf = (i: number, ink: string) => (i === 0 ? ink : i === 1 ? C.ink : C.slate);
const widthOf = (i: number, n: number) => (i === 0 ? (n === 1 ? 3 : 3.2) : i === 1 ? 2 : 1.25);

function lineSvg(series: Series[], o: FigureOpts): string | null {
  const { xs, xLabels, seriesLabels, data } = alignSeries(series);
  const all = data.flat().filter(Number.isFinite);
  if (!xs.length || !all.length) return null;
  const w = o.w ?? 1040;
  const h = o.h ?? 420;
  const ink = o.ink ?? C.c;

  const padT = 26;
  const padB = 44;
  const lo0 = Math.min(...all);
  const hi0 = Math.max(...all);
  const pad = (hi0 - lo0) * 0.08 || Math.abs(hi0) * 0.05 || 1;
  const { lo, hi, step, ticks } = niceTicks(lo0 - pad, hi0 + pad, 4);
  const ylab = tickFmt(step, Math.max(Math.abs(lo), Math.abs(hi)), o.unit);
  // gutter sized to the widest printed y label (≈0.6em per char at 11px)
  const labelW = Math.max(...ticks.map((t) => ylab(t).length)) * 6.6;
  const padL = labelW + 16;
  const endW = Math.max(0, ...data.map((_, i) => (colorOf(i, ink) === C.slate && data.length > 4 ? 0 : (seriesLabels[i] ?? "").length * 6.4 + 30)));
  const padR = Math.max(56, endW + 16);

  const X = (i: number) => padL + (xs.length === 1 ? 0.5 : (i / (xs.length - 1))) * (w - padL - padR);
  const Y = (v: number) => h - padB - ((v - lo) / (hi - lo)) * (h - padT - padB);

  const g: string[] = [svgOpen(w, h, o.label)];
  // no grid line on the first/last tick — top and bottom frame, not data
  for (const t of ticks) {
    const y = Y(t);
    if (t !== ticks[0] && t !== ticks[ticks.length - 1]) g.push(line(padL, y, w - padR, y, C.grid, 1));
    g.push(txt(padL - 8, y + 4, ylab(t), { anchor: "end", size: 11, fill: C.dim }));
  }
  const everyX = Math.max(1, Math.ceil(xs.length / 8));
  xLabels.forEach((lab, i) => {
    if (i % everyX === 0 || i === xs.length - 1) g.push(txt(X(i), h - padB + 20, lab, { anchor: "middle", size: 11, fill: C.mid }));
  });

  data.forEach((vals, si) => {
    const pts = vals.map((v, i) => [X(i), Y(v)] as [number, number]).filter(([, y]) => Number.isFinite(y));
    if (pts.length < 2) return;
    g.push(
      `<path d="${smooth(pts)}" fill="none" style="stroke:${colorOf(si, ink)};stroke-width:${widthOf(si, data.length)};stroke-linecap:round;stroke-linejoin:round"/>`,
    );
    const [lx, ly] = pts[pts.length - 1];
    g.push(`<circle cx="${rr(lx)}" cy="${rr(ly)}" r="${si === 0 ? 4.2 : 3.2}" style="fill:${colorOf(si, ink)}"/>`);
  });

  // direct end labels (rule 6) — lead + rival always, grey only when ≤4 series;
  // naive downward nudge where labels would stack (ceiling: no full declutter).
  const labelled = data.map((_, i) => (data.length > 4 ? i < 2 : true));
  let prevY = -Infinity;
  data.forEach((vals, si) => {
    if (!labelled[si]) return;
    const v = vals[vals.length - 1];
    if (!Number.isFinite(v)) return;
    let y = Y(v);
    if (y - prevY < 13) y = prevY + 13;
    prevY = y;
    g.push(
      txt(X(xs.length - 1) + 10, y + 4, `${seriesLabels[si]}${data.length === 1 ? ` ${fmtNum(v, o.unit)}` : ""}`, {
        size: data.length === 1 ? 14 : 11,
        weight: data.length === 1 ? 600 : 500,
        fill: colorOf(si, ink),
        halo: true,
        serif: data.length === 1,
      }),
    );
  });
  g.push("</svg>");
  return g.join("");
}

/** Categories + one measure → horizontal bars: from zero, names left, values at bar ends. */
function hBarsSvg(categories: string[], values: number[], o: FigureOpts): string | null {
  const n = Math.min(categories.length, values.length);
  if (!n) return null;
  const w = o.w ?? 1040;
  const rowH = 34;
  const padT = 8;
  const padB = 16;
  const h = padT + n * rowH + padB;
  const max = Math.max(...values.map(Math.abs));
  const { hi } = niceTicks(0, max * 1.02, 4);
  const labelW = Math.max(...categories.map((c) => c.length)) * 6.4;
  const valueW = Math.max(...values.map((v) => fmtNum(v, o.unit).length)) * 6.6 + 14;
  const padL = labelW + 14;
  const padR = valueW + 10;
  const barH = rowH * 0.6;
  const trackW = w - padL - padR;

  const g: string[] = [svgOpen(w, h, o.label)];
  const ink = o.ink ?? C.c;
  g.push(line(padL, padT, padL, h - padB, C.grid, 1)); // zero line
  for (let i = 0; i < n; i++) {
    const y = padT + i * rowH + (rowH - barH) / 2;
    const bw = hi > 0 ? (Math.abs(values[i]) / hi) * trackW : 0;
    g.push(txt(padL - 8, y + barH / 2 + 4, categories[i], { anchor: "end", size: 12, fill: C.ink, halo: true }));
    g.push(rect(padL, y, bw, barH, ink, undefined, 3));
    g.push(txt(padL + bw + 7, y + barH / 2 + 4, fmtNum(values[i], o.unit), { size: 11.5, weight: 500, fill: C.ink }));
  }
  g.push("</svg>");
  return g.join("");
}

/** Parts of a whole (pie's data) → stacked share strip + big-number legend. */
function shareStripSvg(categories: string[], values: number[], o: FigureOpts): string | null {
  const n = Math.min(categories.length, values.length);
  const total = values.reduce((a, b) => a + b, 0);
  if (!n || !(total > 0)) return null;
  const w = o.w ?? 1040;
  const stripH = 54;
  const stripY = 14;
  const legendY = stripY + stripH + 34;
  const h = legendY + 40;
  const ops = [1, 0.66, 0.42, 0.24, 0.16, 0.1];
  const pct = (v: number) => {
    const p = (v / total) * 100;
    return `${fmtNum(p, "%")}%`;
  };

  const g: string[] = [svgOpen(w, h, o.label)];
  const ink = o.ink ?? C.c;
  let x = 0;
  for (let i = 0; i < n; i++) {
    const segW = (values[i] / total) * w;
    g.push(rect(x, stripY, Math.max(0, segW - 2), stripH, ink, ops[i % ops.length]));
    const p = (values[i] / total) * 100;
    if (p >= 20) g.push(txt(x + 13, stripY + stripH / 2 + 5, pct(values[i]), { size: 13, weight: 600, fill: C.onC }));
    x += segW;
  }
  // big-number legend beneath
  const itemW = w / n;
  for (let i = 0; i < n; i++) {
    const ix = i * itemW;
    g.push(rect(ix, legendY - 12, 10, 10, ink, ops[i % ops.length]));
    g.push(txt(ix + 17, legendY - 2, categories[i], { size: 12, fill: C.ink }));
    g.push(txt(ix + 17, legendY + 22, pct(values[i]), { size: 20, weight: 500, serif: true, fill: C.ink }));
  }
  g.push("</svg>");
  return g.join("");
}

/** Annulus sector path — donut ring segment between two angles (radians, clockwise from top). */
function ringSeg(cx: number, cy: number, r: number, ri: number, a0: number, a1: number): string {
  const P = (rad: number, a: number) => [rr(cx + rad * Math.sin(a)), rr(cy - rad * Math.cos(a))] as const;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = P(r, a0);
  const [x1, y1] = P(r, a1);
  const [x2, y2] = P(ri, a1);
  const [x3, y3] = P(ri, a0);
  return `M ${x0} ${y0} A ${rr(r)} ${rr(r)} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${rr(ri)} ${rr(ri)} 0 ${large} 0 ${x3} ${y3} Z`;
}

/** Parts of a whole → ring with a center total + direct-labelled legend (share strip's sibling). */
function donutSvg(categories: string[], values: number[], o: FigureOpts): string | null {
  const n = Math.min(categories.length, values.length);
  const total = values.reduce((a, b) => a + b, 0);
  if (!n || !(total > 0)) return null;
  const w = o.w ?? 1040;
  const size = 300;
  const cy = size / 2;
  const r = size / 2 - 8;
  const ri = r * 0.62;
  const h = size + 8;
  const ops = [1, 0.66, 0.42, 0.24, 0.16, 0.1];
  const pct = (v: number) => `${fmtNum((v / total) * 100, "%")}%`;

  const g: string[] = [svgOpen(w, h, o.label)];
  const ink = o.ink ?? C.c;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const span = (values[i] / total) * 2 * Math.PI;
    if (span >= 2 * Math.PI - 1e-6) {
      // full ring — an arc with identical endpoints renders nothing; split in halves
      g.push(`<path d="${ringSeg(cy, cy, r, ri, 0, Math.PI)}" style="fill:${ink}"/>`);
      g.push(`<path d="${ringSeg(cy, cy, r, ri, Math.PI, 2 * Math.PI)}" style="fill:${ink}"/>`);
    } else {
      const gap = Math.min(0.015, span / 4);
      g.push(`<path d="${ringSeg(cy, cy, r, ri, a, Math.max(a + 0.001, a + span - gap))}" style="fill:${ink}" opacity="${ops[i % ops.length]}"/>`);
    }
    a += span;
  }
  g.push(txt(cy, cy + 2, fmtNum(total, o.unit ?? ""), { anchor: "middle", size: 30, weight: 500, serif: true, fill: C.ink, extra: "font-variant-numeric:tabular-nums lining-nums" }));
  g.push(txt(cy, cy + 24, "Total", { anchor: "middle", size: 11, fill: C.dim, extra: "letter-spacing:.08em" }));
  // legend rows to the right of the ring
  const lx = size + 40;
  const rowH = Math.min(46, (h - 16) / n);
  for (let i = 0; i < n; i++) {
    const y = 16 + i * rowH;
    g.push(rect(lx, y, 10, 10, ink, ops[i % ops.length]));
    g.push(txt(lx + 18, y + 10, categories[i], { size: 13, fill: C.ink }));
    g.push(txt(w - 8, y + 11, `${pct(values[i])}  ${fmtNum(values[i], o.unit ?? "")}`, { anchor: "end", size: 13, weight: 500, fill: C.ink, extra: "font-variant-numeric:tabular-nums lining-nums" }));
    if (i < n - 1) g.push(line(lx, y + rowH - 10, w - 8, y + rowH - 10, C.grid, 1));
  }
  g.push("</svg>");
  return g.join("");
}

/** Two axes, one dot cloud — grey context, lead series in the domain ink.
 * ponytail: no fit line / r — add a scatterFit only when a claim needs it. */function scatterSvg(series: Series[], o: FigureOpts): string | null {
  const { xs, xLabels, seriesLabels, data } = alignSeries(series);
  const all = data.flat().filter(Number.isFinite);
  if (!all.length) return null;
  const w = o.w ?? 1040;
  const h = o.h ?? 380;
  const padT = 24;
  const padB = 44;
  const lo0 = Math.min(...all);
  const hi0 = Math.max(...all);
  const pad = (hi0 - lo0) * 0.1 || Math.abs(hi0) * 0.05 || 1;
  const { lo, hi, step, ticks } = niceTicks(lo0 - pad, hi0 + pad, 4);
  const ylab = tickFmt(step, Math.max(Math.abs(lo), Math.abs(hi)), o.unit);
  const padL = Math.max(...ticks.map((t) => ylab(t).length)) * 6.6 + 16;
  const padR = 24;
  const X = (i: number) => padL + (xs.length === 1 ? 0.5 : (i / (xs.length - 1))) * (w - padL - padR);
  const Y = (v: number) => h - padB - ((v - lo) / (hi - lo)) * (h - padT - padB);

  const g: string[] = [svgOpen(w, h, o.label)];
  const ink = o.ink ?? C.c;
  // no grid line on the first/last tick — top and bottom frame, not data
  for (const t of ticks) {
    if (t !== ticks[0] && t !== ticks[ticks.length - 1]) g.push(line(padL, Y(t), w - padR, Y(t), C.grid, 1));
    g.push(txt(padL - 8, Y(t) + 4, ylab(t), { anchor: "end", fill: C.dim }));
  }
  const everyX = Math.max(1, Math.ceil(xs.length / 8));
  xLabels.forEach((lab, i) => {
    if (i % everyX === 0 || i === xs.length - 1) g.push(txt(X(i), h - padB + 20, lab, { anchor: "middle", fill: C.mid }));
  });
  data.forEach((vals, si) => {
    vals.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      g.push(`<circle cx="${rr(X(i))}" cy="${rr(Y(v))}" r="${si === 0 ? 4.5 : 3.5}" style="fill:${colorOf(si, ink)}"/>`);
    });
    const li = seriesLabels[si];
    if (li) g.push(txt(w - padR, padT - 8, li, { anchor: "end", size: 11, fill: colorOf(si, ink), halo: true }));
  });
  g.push("</svg>");
  return g.join("");
}

/** Labels + values → vertical columns from zero (vbar + legacy time-series `bar`). */
function columnsSvg(labels: string[], vals: number[], o: FigureOpts): string | null {
  const finite = vals.filter(Number.isFinite);
  if (!labels.length || !finite.length) return null;
  const w = o.w ?? 1040;
  const h = o.h ?? 360;
  const padT = 24;
  const padB = 44;
  const { hi, step, ticks } = niceTicks(0, Math.max(...finite) * 1.05, 4);
  const ylab = tickFmt(step, hi, o.unit);
  const padL = Math.max(...ticks.map((t) => ylab(t).length)) * 6.6 + 16;
  const padR = 16;
  const Y = (v: number) => h - padB - (v / hi) * (h - padT - padB);
  const stepW = (w - padL - padR) / labels.length;
  const bw = stepW * 0.62;

  const g: string[] = [svgOpen(w, h, o.label)];
  const ink = o.ink ?? C.c;
  for (const t of ticks) {
    // keep the zero baseline; skip the top frame line
    if (!(t !== 0 && t === ticks[ticks.length - 1])) g.push(line(padL, Y(t), w - padR, Y(t), t === 0 ? C.dim : C.grid, t === 0 ? 1.2 : 1));
    g.push(txt(padL - 8, Y(t) + 4, ylab(t), { anchor: "end", fill: C.dim }));
  }
  vals.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const x = padL + i * stepW + (stepW - bw) / 2;
    g.push(rect(x, Y(v), bw, Y(0) - Y(v), ink, undefined, 3));
  });
  const everyX = Math.max(1, Math.ceil(labels.length / 8));
  labels.forEach((lab, i) => {
    if (i % everyX === 0 || i === labels.length - 1) g.push(txt(padL + i * stepW + stepW / 2, h - padB + 20, lab, { anchor: "middle", fill: C.mid }));
  });
  g.push("</svg>");
  return g.join("");
}

/** Series over time as columns (legacy `bar` that resolved to time series). */
function vBarsSvg(series: Series[], o: FigureOpts): string | null {
  const { xLabels, data } = alignSeries(series);
  const vals = data[0];
  if (!vals?.length) return null;
  return columnsSvg(xLabels, vals, o);
}

/** Signed-number inks (skill: colour on data, same pair as table .pos/.neg). */
const signColor = (v: number) => (v > 0 ? C.pos : v < 0 ? C.neg : C.ink);
const signed = (v: number, unit = "") =>
  `${v > 0 ? "+" : ""}${fmtNum(v, unit)}${unit.trim() === "%" ? "%" : ""}`;

/**
 * The ledger stat card: Anek label → huge thin Newsreader numeral → optional
 * sub-line → optional spark (skill: extreme type contrast, colour on data).
 * `categories[0]` label, `categories[1]` sub-line, `values[0]` headline,
 * `series` (or a `data` token) the sparkline.
 */
function statSvg(spec: ChartSpec, o: FigureOpts): string | null {
  const v = spec.values?.[0];
  if (v == null || !Number.isFinite(v)) return null;
  const label = spec.categories?.[0] ?? "";
  const sub = spec.categories?.[1] ?? "";
  const spark = (spec.series ?? [])
    .filter((s) => s.points.length)
    .flatMap((s) => s.points.map((p) => p.v))
    .filter(Number.isFinite);
  const w = o.w ?? 1040;
  const g: string[] = [];

  const valueY = label ? 112 : 92;
  const subY = valueY + 30;
  const bandTop = sub ? subY + 20 : valueY + 26;
  const bandH = 52;
  const h = spark.length >= 2 ? bandTop + bandH + 14 : sub ? subY + 18 : valueY + 16;

  g.push(svgOpen(w, h, o.label));
  if (label) g.push(txt(4, 24, label, { size: 15, weight: 500, fill: C.mid, extra: "letter-spacing:.04em" }));
  g.push(
    txt(4, valueY, signed(v, o.unit ?? ""), {
      size: 86,
      weight: 300,
      serif: true,
      fill: signColor(v),
      extra: "font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.03em",
    }),
  );
  if (sub) g.push(txt(4, subY, sub, { size: 14, fill: C.dim }));
  if (spark.length >= 2) {
    const lo = Math.min(...spark);
    const hi = Math.max(...spark);
    const yOf = (x: number) => (hi > lo ? bandTop + (1 - (x - lo) / (hi - lo)) * bandH : bandTop + bandH / 2);
    const pts = spark.map((x, i) => [4 + (i / (spark.length - 1)) * (w - 20), yOf(x)] as [number, number]);
    g.push(`<path d="${smooth(pts)}" fill="none" style="stroke:${C.slate};stroke-width:1.25;stroke-linecap:round"/>`);
    const [ex, ey] = pts[pts.length - 1];
    g.push(`<circle cx="${rr(ex)}" cy="${rr(ey)}" r="4" style="fill:${o.ink ?? C.c}"/>`);
  }
  g.push("</svg>");
  return g.join("");
}

/**
 * The movers board: name/value rows on hairlines, two columns past five rows,
 * +/− coloured values right-aligned and tabular (skill: hairline rows, no
 * vertical rules; numbers set, never improvised).
 * `categories` names, `values` signed numbers, `measure` the unit ("%").
 */
function moversSvg(spec: ChartSpec, o: FigureOpts): string | null {
  const n = Math.min(spec.categories?.length ?? 0, spec.values?.length ?? 0);
  if (!n) return null;
  const cats = spec.categories!;
  const vals = spec.values!;
  const w = o.w ?? 1040;
  const twoCol = n > 5;
  const rows = twoCol ? Math.ceil(n / 2) : n;
  const rowH = 40;
  const padT = 10;
  const h = padT + rows * rowH + 10;
  const gap = 48;
  const colW = twoCol ? (w - gap) / 2 : w;

  const g: string[] = [svgOpen(w, h, o.label)];
  for (let i = 0; i < n; i++) {
    const col = twoCol && i >= rows ? 1 : 0;
    const r = i - col * rows;
    const x0 = col * (colW + gap);
    const yTop = padT + r * rowH;
    if (r > 0) g.push(line(x0, yTop, x0 + colW, yTop, C.grid, 1));
    const mid = yTop + rowH / 2;
    g.push(txt(x0, mid + 5, cats[i], { size: 13.5, weight: 500, fill: C.ink, extra: "letter-spacing:.06em" }));
    g.push(
      txt(x0 + colW, mid + 5, signed(vals[i], o.unit ?? ""), {
        anchor: "end",
        size: 13.5,
        weight: 500,
        fill: signColor(vals[i]),
        extra: "font-variant-numeric:tabular-nums lining-nums",
      }),
    );
  }
  g.push("</svg>");
  return g.join("");
}

/**
 * The ledger table figure: column headers in small caps, hairline rows (no
 * vertical rules), numbers right-aligned and tabular — the movers board's
 * discipline applied to multi-column data. USE INSTEAD OF markdown tables.
 * `columns` headers, `rows` arrays of string|number cells.
 */
function tableSvg(spec: ChartSpec, o: FigureOpts): string | null {
  const cols = spec.columns ?? [];
  const rows = (spec.rows ?? []).filter((r) => r.length);
  if (!cols.length || !rows.length) return null;
  const w = o.w ?? 1040;
  const padT = 8;
  const rowH = 34;
  const h = padT + (rows.length + 1) * rowH + 10;
  const colW = w / cols.length;
  const isNum = (c: unknown) => typeof c === "number" && Number.isFinite(c);

  const g: string[] = [svgOpen(w, h, o.label)];
  // headers: small caps, dim, letterspaced, at column starts
  cols.forEach((c, i) => {
    g.push(txt(i === 0 ? 2 : i * colW + 8, padT + 16, String(c), { size: 11, weight: 600, fill: C.dim, extra: "letter-spacing:.08em" }));
  });
  rows.forEach((row, r) => {
    const yTop = padT + (r + 1) * rowH;
    g.push(line(0, yTop, w, yTop, C.grid, 1));
    const mid = yTop + rowH / 2;
    row.forEach((cell, i) => {
      if (i >= cols.length) return;
      const num = isNum(cell);
      // numbers right-align at the column end (tabular); text left-aligns
      const x = num ? (i + 1) * colW - 10 : i === 0 ? 2 : i * colW + 8;
      const text = num ? fmtNum(cell as number, o.unit ?? "") : String(cell ?? "");
      g.push(
        txt(x, mid + 4, text, {
          anchor: num ? "end" : "start",
          size: 13,
          weight: num ? 500 : 400,
          fill: C.ink,
          extra: num ? "font-variant-numeric:tabular-nums lining-nums" : "",
        }),
      );
    });
  });
  g.push("</svg>");
  return g.join("");
}

/**
 * Candlesticks on the shared time axis: bodies + wicks for series[0],
 * overlays (SMA…) as lines on the same scale. Close-only points (no o/h/l)
 * fall back to a line — the same fallback the UI's MarketChart takes.
 * The UI still gets the live chart (renderFigures skips candle blocks); this
 * is the static form the markdown dump ships.
 */
function candleSvg(spec: ChartSpec, o: FigureOpts): string | null {
  const series = (spec.series ?? []).filter((s) => s.points.length);
  if (!series.length) return null;
  const bars = series[0];
  if (!bars.points.every((p) => p.o != null && p.h != null && p.l != null)) return lineSvg(series, o);
  const { xs, xLabels, data, seriesLabels } = alignSeries(series);
  if (!xs.length) return null;

  const overlayVals = data.flat().filter(Number.isFinite);
  const lo0 = Math.min(...bars.points.map((p) => p.l!), ...overlayVals);
  const hi0 = Math.max(...bars.points.map((p) => p.h!), ...overlayVals);

  const w = o.w ?? 1040;
  const h = o.h ?? 420;
  const ink = o.ink ?? C.c;
  const padT = 26;
  const padB = 44;
  const pad = (hi0 - lo0) * 0.08 || Math.abs(hi0) * 0.05 || 1;
  const { lo, hi, step, ticks } = niceTicks(lo0 - pad, hi0 + pad, 4);
  const ylab = tickFmt(step, Math.max(Math.abs(lo), Math.abs(hi)), o.unit);
  const labelW = Math.max(...ticks.map((t) => ylab(t).length)) * 6.6;
  const padL = labelW + 16;
  const endW = Math.max(0, ...data.map((_, i) => (colorOf(i, ink) === C.slate && data.length > 4 ? 0 : (seriesLabels[i] ?? "").length * 6.4 + 30)));
  const padR = Math.max(56, endW + 16);
  const X = (i: number) => padL + (xs.length === 1 ? 0.5 : i / (xs.length - 1)) * (w - padL - padR);
  const Y = (v: number) => h - padB - ((v - lo) / (hi - lo)) * (h - padT - padB);

  const g: string[] = [svgOpen(w, h, o.label)];
  for (const t of ticks) {
    const y = Y(t);
    if (t !== ticks[0] && t !== ticks[ticks.length - 1]) g.push(line(padL, y, w - padR, y, C.grid, 1));
    g.push(txt(padL - 8, y + 4, ylab(t), { anchor: "end", size: 11, fill: C.dim }));
  }
  const everyX = Math.max(1, Math.ceil(xs.length / 8));
  xLabels.forEach((lab, i) => {
    if (i % everyX === 0 || i === xs.length - 1) g.push(txt(X(i), h - padB + 20, lab, { anchor: "middle", size: 11, fill: C.mid }));
  });

  // candles — up inks with the plot, down with the negative ink (house pair)
  const idx = new Map(xs.map((t, i) => [t, i]));
  const stepW = xs.length > 1 ? (w - padL - padR) / (xs.length - 1) : w - padL - padR;
  const bw = Math.min(Math.max(stepW * 0.62, 1.5), 14);
  for (const p of bars.points) {
    const i = idx.get(p.t);
    if (i == null) continue;
    const x = X(i);
    const up = p.v >= (p.o ?? p.v);
    const color = up ? ink : C.neg;
    g.push(line(x, Y(p.h!), x, Y(p.l!), color, 1));
    const bodyTop = Y(Math.max(p.o ?? p.v, p.v));
    const bh = Math.max(Math.abs(Y(Math.min(p.o ?? p.v, p.v)) - bodyTop), 1.2);
    g.push(rect(x - bw / 2, bodyTop, bw, bh, color));
  }

  // overlays (SMA…) as lines on the same scale — close IS the candles
  data.forEach((vals, si) => {
    if (si === 0) return;
    const pts = vals.map((v, i) => [X(i), Y(v)] as [number, number]).filter(([, y]) => Number.isFinite(y));
    if (pts.length < 2) return;
    g.push(`<path d="${smooth(pts)}" fill="none" style="stroke:${colorOf(si, ink)};stroke-width:${widthOf(si, data.length)};stroke-linecap:round;stroke-linejoin:round"/>`);
    const [lx, ly] = pts[pts.length - 1];
    g.push(`<circle cx="${rr(lx)}" cy="${rr(ly)}" r="3.2" style="fill:${colorOf(si, ink)}"/>`);
  });

  // direct end labels — lead prints its last value, rivals just the name
  let prevY = -Infinity;
  data.forEach((vals, si) => {
    const v = vals[vals.length - 1];
    if (!Number.isFinite(v)) return;
    let y = Y(v);
    if (y - prevY < 13) y = prevY + 13;
    prevY = y;
    g.push(
      txt(X(xs.length - 1) + 10, y + 4, `${seriesLabels[si]}${data.length === 1 ? ` ${fmtNum(v, o.unit)}` : ""}`, {
        size: data.length === 1 ? 14 : 11,
        weight: data.length === 1 ? 600 : 500,
        fill: colorOf(si, ink),
        halo: true,
        serif: data.length === 1,
      }),
    );
  });
  g.push("</svg>");
  return g.join("");
}

/**
 * Render one chart spec to a self-contained SVG string, or null when there is
 * nothing honest to draw (unresolved data token).
 */
export function renderFigure(spec: ChartSpec, o: FigureOpts = {}): string | null {
  if (spec.color) o = { ...o, ink: spec.color };
  if (spec.kind === "candle") return candleSvg(spec, o);
  if (spec.kind === "stat") return statSvg(spec, o);
  if (spec.kind === "movers") return moversSvg(spec, o);
  if (spec.kind === "table") return tableSvg(spec, o);
  if (spec.categories?.length && spec.values?.length) {
    if (spec.kind === "pie") return shareStripSvg(spec.categories, spec.values, o);
    if (spec.kind === "donut") return donutSvg(spec.categories, spec.values, o);
    if (spec.kind === "vbar") return columnsSvg(spec.categories, spec.values, o);
    // hbar | radar | legacy bar — radar's data IS categories+values; the honest form is bars
    return hBarsSvg(spec.categories, spec.values, o);
  }
  const series = (spec.series ?? []).filter((s) => s.points.length);
  if (!series.length) return null;
  if (spec.kind === "vbar" || spec.kind === "bar") return vBarsSvg(series, o);
  if (spec.kind === "scatter") return scatterSvg(series, o);
  // line | multiline | area — area draws as a plain line (single-line house rule: no wash)
  return lineSvg(series, o);
}

/** Chart data → CSV (figure download / markdown Data block). */
export function figureCsv(spec: ChartSpec): string {
  const q = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  if (spec.columns?.length && spec.rows?.length) {
    return [spec.columns, ...spec.rows].map((row) => row.map((c) => q(String(c))).join(",")).join("\n");
  }
  if (spec.categories?.length && spec.values) {
    return [["name", "value"], ...spec.categories.map((c, i) => [c, String(spec.values?.[i] ?? "")])]
      .map((row) => row.map(q).join(","))
      .join("\n");
  }
  const series = (spec.series ?? []).filter((s) => s.points.length);
  if (!series.length) return "";
  const set = new Set<number>();
  for (const s of series) for (const p of s.points) set.add(p.t);
  const ts = [...set].sort((a, b) => a - b);
  const maps = series.map((s) => new Map(s.points.map((p) => [p.t, p.v])));
  const date = (t: number) => new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10);
  const head = ["date", ...series.map((s) => s.label)].map(q).join(",");
  const rows = ts.map((t) => [date(t), ...maps.map((m) => { const v = m.get(t); return v == null ? "" : String(v); })].map(q).join(","));
  return [head, ...rows].join("\n");
}
