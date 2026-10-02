import { describe, it, expect, vi, beforeAll } from "vitest";

// next-themes reads window.matchMedia in its effect; jsdom has none.
beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: false, media: q, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});
import { render, screen } from "@testing-library/react";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import { ReportBlockRenderer, type ReportBlock } from "../components/builder/ReportBlockRenderer";

vi.mock("../components/builder/MarketChart", () => ({
  MarketChart: (props: { variant: string; data: unknown[] }) => (
    <div data-testid="market-chart" data-variant={props.variant} data-rows={props.data.length} />
  ),
}));

const wrap = (n: React.ReactNode) => (
  <ChakraProvider value={createSystem(defaultConfig)}>
    <ThemeProvider attribute="class" defaultTheme="dark">{n}</ThemeProvider>
  </ChakraProvider>
);

// Real block shapes from a completed technical-analysis run: OHLCV +
// SMA overlays (candlestick), RSI (line), volume-over-time (bar,
// date-keyed), and a categorical score bar (name-keyed).
const priceSma: ReportBlock = {
  type: "chart",
  chartType: "candlestick",
  title: "Price — 1 year daily with SMA 20/50/200",
  data: [
    { date: "2025-02-28", open: 236.95, high: 242.09, low: 230.2, close: 241.84, volume: 56833400, sma20: "", sma50: "", sma200: "" },
    { date: "2025-03-03", open: 242.5, high: 245.1, low: 240.0, close: 244.2, volume: 49000000, sma20: 243.1, sma50: 240.5, sma200: 228.7 },
  ],
  sourceKeys: ["code:marketdata.price_history"],
};
const rsi: ReportBlock = {
  type: "chart",
  chartType: "line",
  title: "RSI (14) — last 6 months",
  data: [
    { date: "2025-03-20", rsi: 21.67 },
    { date: "2025-03-21", rsi: 24.1 },
  ],
  sourceKeys: ["code:marketdata.rsi14"],
};
const volume: ReportBlock = {
  type: "chart",
  chartType: "bar",
  title: "Volume — last 3 months",
  data: [
    { date: "2026-07-06", volume: 53590000 },
    { date: "2026-07-07", volume: 48100000 },
  ],
  sourceKeys: ["code:marketdata.price_history"],
};
const scores: ReportBlock = {
  type: "chart",
  chartType: "bar",
  title: "Skill scores — weighted aggregate 87.5",
  data: [{ name: "Technical Analysis", score: 87.5 }],
  sourceKeys: ["code:aggregate.per_skill"],
};

describe("report chart routing", () => {
  it("date-keyed market series render on lightweight-charts", () => {
    render(wrap(<ReportBlockRenderer blocks={[priceSma, rsi, volume]} />));
    const charts = screen.getAllByTestId("market-chart");
    expect(charts.map((c) => c.dataset.variant)).toEqual(["candle", "line", "volume"]);
    expect(charts[0].dataset.rows).toBe("2");
    expect(screen.getByText("Price — 1 year daily with SMA 20/50/200")).toBeTruthy();
  });

  it("categorical charts stay on recharts", () => {
    render(wrap(<ReportBlockRenderer blocks={[scores]} />));
    expect(screen.queryByTestId("market-chart")).toBeNull();
  });
});
