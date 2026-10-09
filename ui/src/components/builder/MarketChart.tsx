/**
 * MarketChart — price-type report charts rendered with TradingView
 * Lightweight Charts v5 (per the technical-analysis skill's binding
 * chart rules). Handles three variants:
 *   - candle: OHLC candlesticks + SMA overlay lines + volume pane
 *   - line:   time-series lines (RSI gets a fixed 0–100 scale)
 *   - volume: time-series volume histogram
 * Non-time-series visuals (radar, pie, categorical bars keyed by
 * anything other than `date`) stay on recharts in ReportBlockRenderer.
 */
import { useEffect, useMemo, useRef } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import {
  createChart,
  AreaSeries,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type Time,
} from "lightweight-charts";

export type MarketRow = Record<string, string | number>;
export type MarketChartVariant = "candle" | "line" | "volume";

/** Shared block-series palette — same colors ReportBlockRenderer gives recharts series. */
const SERIES_COLORS = ["#5B7FDE", "#4C8B6B", "#B8935A", "#8FA0C8", "#B85C5C"];

const SERIES_LABELS: Record<string, string> = {
  close: "Close",
  sma20: "SMA 20",
  sma50: "SMA 50",
  sma200: "SMA 200",
  rsi: "RSI (14)",
  rsi_14: "RSI (14)",
};

const labelFor = (key: string) =>
  SERIES_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Resolve a theme token to a concrete color. lightweight-charts
 * parses colors itself — `var(--token)` strings are invalid, so the
 * token must be read via getComputedStyle with a fallback.
 */
const themeColor = (token: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

interface ParsedSeries {
  key: string;
  label: string;
  color: string;
  points: LineData<Time>[];
}

interface LegendEntry {
  label: string;
  color: string;
}

type ChartModel =
  | {
      kind: "candle";
      ariaLabel: string;
      legend: LegendEntry[];
      tableHead: string[];
      tableRows: (string | number)[][];
      candles: CandlestickData<Time>[];
      overlays: ParsedSeries[];
      volume: { time: Time; value: number; up: boolean }[];
    }
  | {
      kind: "line";
      ariaLabel: string;
      legend: LegendEntry[];
      tableHead: string[];
      tableRows: (string | number)[][];
      series: ParsedSeries[];
      /** RSI-type series: pin the price scale to 0–100 so the axis never clips. */
      bounded: boolean;
    }
  | {
      kind: "volume";
      ariaLabel: string;
      legend: LegendEntry[];
      tableHead: string[];
      tableRows: (string | number)[][];
      bars: HistogramData<Time>[];
    };

/** Sort ascending by date and drop duplicates — out-of-order or repeated points throw at setData. */
function timeSorted(data: MarketRow[]): MarketRow[] {
  const seen = new Set<string>();
  return data
    .filter((r) => typeof r.date === "string" && !seen.has(r.date) && !!seen.add(r.date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

const pct = (from: number, to: number) => (from === 0 ? 0 : ((to - from) / Math.abs(from)) * 100);

function buildCandleModel(data: MarketRow[]): ChartModel | null {
  const rows = timeSorted(data);
  const candles: CandlestickData<Time>[] = [];
  const volume: { time: Time; value: number; up: boolean }[] = [];
  const overlayKeys = Object.keys(rows[0] ?? {}).filter(
    (k) => k !== "date" && k !== "open" && k !== "high" && k !== "low" && k !== "close" && k !== "volume",
  );
  const overlays: ParsedSeries[] = overlayKeys.map((k, i) => ({ key: k, label: labelFor(k), color: SERIES_COLORS[i % SERIES_COLORS.length], points: [] }));
  const tableRows: (string | number)[][] = [];

  for (const r of rows) {
    const { open, high, low, close } = r;
    if (!finite(open) || !finite(high) || !finite(low) || !finite(close)) continue;
    const time = r.date as Time;
    candles.push({ time, open, high, low, close });
    if (finite(r.volume)) volume.push({ time, value: r.volume, up: close >= open });
    for (const s of overlays) {
      const v = r[s.key];
      if (finite(v)) s.points.push({ time, value: v });
    }
    tableRows.push([r.date, open, high, low, close, finite(r.volume) ? r.volume : ""]);
  }
  if (candles.length < 5) return null;

  const first = candles[0];
  const last = candles[candles.length - 1];
  const change = pct(first.close, last.close);
  const legend: LegendEntry[] = [
    { label: "Price", color: themeColor("--signal-positive", "#2f9e6e") },
    ...overlays.filter((s) => s.points.length > 0).map((s) => ({ label: s.label, color: s.color })),
    ...(volume.length ? [{ label: "Volume", color: themeColor("--ink-tertiary", "#6b7280") }] : []),
  ];
  return {
    kind: "candle",
    ariaLabel: `Daily candlestick chart from ${String(first.time)} to ${String(last.time)}: ${first.close} to ${last.close}, ${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)} percent.`,
    legend,
    tableHead: ["Date", "Open", "High", "Low", "Close", "Volume"],
    tableRows,
    candles,
    overlays: overlays.filter((s) => s.points.length > 0),
    volume,
  };
}

function buildLineModel(data: MarketRow[]): ChartModel | null {
  const rows = timeSorted(data);
  const keys = Object.keys(rows[0] ?? {}).filter((k) => k !== "date");
  const series: ParsedSeries[] = keys.map((k, i) => ({ key: k, label: labelFor(k), color: SERIES_COLORS[i % SERIES_COLORS.length], points: [] }));
  const tableRows: (string | number)[][] = [];

  for (const r of rows) {
    const time = r.date as Time;
    let any = false;
    for (const s of series) {
      const v = r[s.key];
      if (finite(v)) {
        s.points.push({ time, value: v });
        any = true;
      }
    }
    if (any) tableRows.push([r.date, ...series.map((s) => (finite(r[s.key]) ? r[s.key] : ""))]);
  }
  const usable = series.filter((s) => s.points.length >= 2);
  if (usable.length === 0) return null;

  const bounded = keys.some((k) => k === "rsi" || k === "rsi_14");
  const primary = usable[0];
  const first = primary.points[0];
  const last = primary.points[primary.points.length - 1];
  const change = pct(first.value, last.value);
  return {
    kind: "line",
    ariaLabel: `Line chart from ${String(first.time)} to ${String(last.time)}: ${primary.label} ${first.value} to ${last.value}, ${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)} percent.`,
    legend: usable.map((s) => ({ label: s.label, color: s.color })),
    tableHead: ["Date", ...usable.map((s) => s.label)],
    tableRows,
    series: usable,
    bounded,
  };
}

function buildVolumeModel(data: MarketRow[]): ChartModel | null {
  const rows = timeSorted(data);
  const valueKey = Object.keys(rows[0] ?? {}).find((k) => k !== "date");
  if (!valueKey) return null;
  const bars: HistogramData<Time>[] = [];
  const tableRows: (string | number)[][] = [];
  for (const r of rows) {
    const v = r[valueKey];
    if (!finite(v)) continue;
    bars.push({ time: r.date as Time, value: v });
    tableRows.push([r.date, v]);
  }
  if (bars.length < 2) return null;
  const peak = Math.max(...bars.map((b) => b.value));
  return {
    kind: "volume",
    ariaLabel: `Volume histogram from ${String(bars[0].time)} to ${String(bars[bars.length - 1].time)}: peak ${peak}.`,
    legend: [{ label: labelFor(valueKey), color: themeColor("--accent-primary", "#5B7FDE") }],
    tableHead: ["Date", labelFor(valueKey)],
    tableRows,
    bars,
  };
}

export interface MarketChartProps {
  data: MarketRow[];
  variant: MarketChartVariant;
  height?: number;
  /** Chart title — used for the hidden data table's caption. */
  title?: string;
}

export function MarketChart({ data, variant, height = 380, title }: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const model = useMemo<ChartModel | null>(() => {
    if (!Array.isArray(data) || data.length === 0) return null;
    return variant === "candle" ? buildCandleModel(data) : variant === "line" ? buildLineModel(data) : buildVolumeModel(data);
  }, [data, variant]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !model) return;

    const grid = themeColor("--hairline", "#e5e7eb");
    const ink = themeColor("--ink-tertiary", "#6b7280");
    const up = themeColor("--signal-positive", "#2f9e6e");
    const down = themeColor("--signal-negative", "#c05050");
    const accent = themeColor("--accent-primary", "#5B7FDE");

    const chart = createChart(container, {
      // attributionLogo: false — the library's TradingView mark is removed
      // from every plot; charts carry the app's own title and legend instead.
      layout: { background: { type: "solid", color: "transparent" }, textColor: ink, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: {
        vertLine: { color: ink, labelBackgroundColor: accent },
        horzLine: { color: ink, labelBackgroundColor: accent },
      },
      timeScale: { borderColor: grid, timeVisible: false, rightOffset: 2 },
      rightPriceScale: { borderColor: grid },
      width: container.clientWidth,
      height,
    });

    if (model.kind === "candle") {
      const candles = chart.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        wickUpColor: up,
        wickDownColor: down,
        borderVisible: false,
      });
      candles.setData(model.candles);
      for (const s of model.overlays) {
        const line = chart.addSeries(LineSeries, {
          color: s.color,
          lineWidth: 1,
          title: s.label,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        line.setData(s.points);
      }
      if (model.volume.length > 0) {
        // Volume rides its own overlay scale in the bottom 15% of the
        // pane — a separate scale, never the price scale.
        const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" });
        vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
        vol.setData(model.volume.map((v) => ({ time: v.time, value: v.value, color: (v.up ? up : down) + "66" })));
      }
    } else if (model.kind === "line") {
      // AreaSeries = line + gradient fill: 40% under the line fading to
      // 8% at the axis — visible taper, never a full fade to nothing.
      for (const s of model.series) {
        const line = chart.addSeries(AreaSeries, {
          lineColor: s.color,
          lineWidth: 2,
          topColor: s.color + "66",
          bottomColor: s.color + "14",
          title: s.label,
          priceLineVisible: model.series.length === 1,
          crosshairMarkerRadius: 3,
          ...(model.bounded ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) } : {}),
        });
        line.setData(s.points);
      }
    } else {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" } });
      vol.setData(model.bars.map((b) => ({ ...b, color: accent + "99" })));
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    ro.observe(container);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [model, height]);

  if (!model) {
    return <Text fontSize="12px" color="var(--ink-tertiary)">Not enough data to chart this series.</Text>;
  }

  return (
    <Box position="relative">
      <Box role="img" aria-label={model.ariaLabel}>
        <div ref={containerRef} style={{ width: "100%", height }} />
      </Box>
      <Flex wrap="wrap" gap={4} mt={2}>
        {model.legend.map((entry) => (
          <Flex key={entry.label} align="center" gap={1.5}>
            <Box w="8px" h="8px" borderRadius="1px" bg={entry.color} />
            <Text fontSize="11px" color="var(--ink-tertiary)">{entry.label}</Text>
          </Flex>
        ))}
      </Flex>
      <table
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        <caption>{title ?? "Chart data"}</caption>
        <thead>
          <tr>{model.tableHead.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {model.tableRows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}
