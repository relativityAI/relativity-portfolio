import { useEffect, useRef } from "react";
import { Box } from "@chakra-ui/react";
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, type Time } from "lightweight-charts";

interface Props {
  spec: any;
  data: any[];
  height?: number;
}

export default function LightweightWrapper({ spec, data, height = 360 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !data || data.length === 0) return;
    const variant = spec?.variant || "line";
    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { type: "solid", color: "transparent" }, textColor: getComputedStyle(document.documentElement).getPropertyValue("--ink-tertiary").trim() || "#666", attributionLogo: false },
      grid: { vertLines: { color: "var(--hairline,#eee)" }, horzLines: { color: "var(--hairline,#eee)" } as any },
    } as any);
    if (variant === "candle") {
      const series = chart.addSeries(CandlestickSeries, {} as any);
      const candles = data
        .filter((r: any) => r.date && r.open != null && r.high != null && r.low != null && r.close != null)
        .map((r: any) => ({ time: r.date as Time, open: r.open, high: r.high, low: r.low, close: r.close }));
      if (candles.length) series.setData(candles as any);
      const volKeys = data[0] && Object.keys(data[0]).includes("volume");
      if (volKeys) {
        const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" } as any);
        vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } } as any);
        const bars = data.filter((r: any) => r.volume != null && r.open != null && r.close != null).map((r: any) => ({ time: r.date as Time, value: r.volume, color: r.close >= r.open ? "rgba(47,158,110,0.4)" : "rgba(192,80,80,0.4)" }));
        if (bars.length) vol.setData(bars as any);
      }
    } else if (variant === "volume") {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" } } as any);
      const bars = data.filter((r: any) => (r.value != null || r.volume != null)).map((r: any) => ({ time: r.date as Time, value: r.value ?? r.volume }));
      if (bars.length) vol.setData(bars as any);
    } else {
      const series = chart.addSeries(LineSeries, {} as any);
      const keys = data[0] ? Object.keys(data[0]).filter((k) => k !== "date") : [];
      // plot first numeric key
      const k = keys[0];
      if (k) {
        const pts = data.filter((r: any) => r.date && r[k] != null).map((r: any) => ({ time: r.date as Time, value: r[k] }));
        if (pts.length) series.setData(pts as any);
      }
    }
    const resize = () => {
      if (el) chart.applyOptions({ width: el.clientWidth });
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
    };
  }, [data, spec, height]);
  return <Box ref={ref} w="100%" />;
}
