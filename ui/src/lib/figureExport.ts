/**
 * Figure downloads (skill rule 7: every figure leaves the page whole —
 * SVG + PNG + CSV). SVG is the stored assembly string; CSV flattens the
 * spec; PNG rasterises through an <img>, where CSS vars don't resolve, so
 * the export uses the var() fallbacks (light palette) in both themes.
 * ponytail: swap to resolved colours if dark-mode PNGs matter.
 */
import type { ChartSpec } from "./reportContract";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "figure";

function save(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2_000);
}

export function downloadSvg(svg: string, name: string) {
  save(URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" })), `${slug(name)}.svg`);
}

export function downloadPng(svg: string, name: string, width = 1040) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const height = Math.round((img.naturalHeight || 420) * (width / (img.naturalWidth || width)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => b && save(URL.createObjectURL(b), `${slug(name)}.png`));
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

/** Spec → CSV rows (mirrors api figure-kit.figureCsv — types are mirrored too). */
export function downloadCsv(spec: ChartSpec, name: string) {
  const q = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  let csv = "";
  if (spec.categories?.length && spec.values) {
    csv = [["name", "value"], ...spec.categories.map((c, i) => [c, String(spec.values?.[i] ?? "")])]
      .map((r) => r.map(q).join(","))
      .join("\n");
  } else {
    const series = (spec.series ?? []).filter((s) => s.points.length);
    const set = new Set<number>();
    for (const s of series) for (const p of s.points) set.add(p.t);
    const ts = [...set].sort((a, b) => a - b);
    const maps = series.map((s) => new Map(s.points.map((p) => [p.t, p.v])));
    const date = (t: number) => new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10);
    csv = [
      ["date", ...series.map((s) => s.label)].map(q).join(","),
      ...ts.map((t) => [date(t), ...maps.map((m) => { const v = m.get(t); return v == null ? "" : String(v); })].map(q).join(",")),
    ].join("\n");
  }
  save(URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), `${slug(name)}.csv`);
}
