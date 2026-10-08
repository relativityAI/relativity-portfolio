import type { PlotSpec, StructuredBlock } from "../types/plots.js";

const SERIES_COLORS = ["#5B7FDE", "#4C8B6B", "#B8935A", "#8FA0C8", "#B85C5C"];

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function inferSchemaFromData(data: any[]): string | undefined {
  if (!Array.isArray(data) || data.length === 0) return undefined;
  const first = data[0] || {};
  const keys = Object.keys(first);
  if (keys.includes("date") && keys.includes("open") && keys.includes("high") && keys.includes("low") && keys.includes("close")) {
    return "ohlcv";
  }
  if (keys.includes("date")) {
    const hasValue = keys.some((k) => k !== "date");
    if (hasValue) return "series";
  }
  if (keys.length >= 2) {
    const numeric = keys.filter((k) => data.every((r: any) => r?.[k] == null || isFiniteNum(r[k])));
    if (numeric.length >= 2) return "table_numeric";
  }
  return "table";
}

export function recommendPlotFromBlock(block: any): PlotSpec[] {
  const out: PlotSpec[] = [];
  if (block?.type !== "chart") return out;
  const data = Array.isArray(block.data) ? block.data : [];
  if (data.length === 0) return out;
  const schema = inferSchemaFromData(data) || "table";
  const title = block.title || "";
  const baseId = slug(title || `chart-${block.chartType || "generic"}`) || uid("plot");

  if (schema === "ohlcv") {
    out.push({
      id: `${baseId}-candle`,
      type: "lightweight",
      title,
      caption: block.title,
      data,
      spec: { variant: "candle" },
      supportsInteraction: true,
      interactive: true,
    });
    return out;
  }
  if (schema === "series") {
    const first = data[0] || {};
    const keys = Object.keys(first).filter((k) => k !== "date");
    const bounded = keys.some((k) => k === "rsi" || k === "rsi_14");
    out.push({
      id: `${baseId}-line`,
      type: "lightweight",
      title,
      caption: block.title,
      data,
      spec: { variant: "line", bounded },
      supportsInteraction: true,
      interactive: true,
    });
    // If volume present, add volume pane? detect
    if (keys.includes("volume")) {
      const volData = data.map((r: any) => ({ date: r.date, volume: r.volume })).filter((r: any) => isFiniteNum(r.volume));
      if (volData.length > 1) {
        out.push({
          id: `${baseId}-volume`,
          type: "lightweight",
          title: title ? `${title} — Volume` : "Volume",
          caption: "Volume",
          data: volData.map((r: any) => ({ date: r.date, value: r.value ?? r.volume })),
          spec: { variant: "volume" },
          supportsInteraction: true,
          interactive: true,
        });
      }
    }
    return out;
  }
  // Generic: keep as vega-lite simple spec if numeric pairs? but UI has recharts fallback; lightweight not ideal
  // For non-market, still can emit lightweight line if date-like? no. But prefer vega-lite minimal.
  out.push({
    id: `${baseId}-vl`,
    type: "vega-lite",
    title,
    caption: block.title,
    data,
    spec: {
      mark: block.chartType === "bar" ? "bar" : block.chartType === "area" ? "area" : "point",
      encoding: {},
    },
    supportsInteraction: true,
    interactive: true,
  });
  return out;
}

export function blocksToStructured(blocks: any[]): StructuredBlock[] {
  const res: StructuredBlock[] = [];
  for (let i = 0; i < (blocks || []).length; i++) {
    const b = blocks[i];
    res.push({
      id: `block-${i}`,
      kind: b?.type === "table" ? "table" : b?.type === "chart" ? "series" : "text",
      text: b?.text,
      data: b?.data,
      schema: b?.type === "chart" ? inferSchemaFromData(b.data || []) : undefined,
    });
  }
  return res;
}

export function derivePlotsFromBlocks(blocks: any[]): PlotSpec[] {
  const plots: PlotSpec[] = [];
  const seen = new Set<string>();
  for (const b of blocks || []) {
    for (const p of recommendPlotFromBlock(b)) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        plots.push(p);
      }
    }
  }
  return plots;
}
