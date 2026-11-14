import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Center, Spinner } from "@chakra-ui/react";
import { useColorMode } from "@/components/ui/color-mode";
import { API_BASE } from "@/db";
import { TickerLogo } from "@/lib/sourceLogos";
import Echart from "@/components/shared/Echart";
import AgentCell, { type AgentCellAgent } from "@/components/shared/AgentCell";
import { resolvedTheme, tooltipStyle } from "@/lib/echarts";

interface Overview {
    symbol: string;
    name: string;
    price: number | null;
    change: number | null;
    change_pct: number | null;
    currency: string;
    market_cap: number | null;
    pe: number | null;
    prev_close: number | null;
    volume: number | null;
    fifty_two_week_high: number | null;
    fifty_two_week_low: number | null;
    exchange: string;
    ltp_time: string | null;
    period: string;
    candles: { date: string; close: number }[];
}

const fmt = (n: number | null | undefined, currency?: string, compact = false) =>
    n == null || !Number.isFinite(n)
        ? "—"
        : new Intl.NumberFormat(
              currency === "INR" ? "en-IN" : "en-US",
              compact ? { notation: "compact", maximumFractionDigits: 2 } : { maximumFractionDigits: 2 },
          ).format(n);

/** Price with its currency symbol (₹1,324 / $342.37). */
const fmtPrice = (n: number | null | undefined, currency?: string) => {
    if (n == null || !Number.isFinite(n)) return "—";
    if (!currency) return fmt(n, currency);
    try {
        return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
            style: "currency",
            currency,
            currencyDisplay: "narrowSymbol",
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(n);
    } catch {
        return fmt(n, currency);
    }
};

const RATINGS = [
    { label: "Very poor", color: "#C0453F" },
    { label: "Poor", color: "#D97736" },
    { label: "Fair", color: "#C9A227" },
    { label: "Good", color: "#7FA650" },
    { label: "Excellent", color: "#4C8B6B" },
];

// UI-only placeholder runs — real per-stock runs wire up later.
const AGENT_SEEDS = [
    { suffix: "Value Agent", seed: "value", when: "Today, 09:42", rating: 4 },
    { suffix: "Momentum Agent", seed: "momentum", when: "Today, 09:45", rating: 3 },
    { suffix: "Quality Agent", seed: "quality", when: "Today, 09:40", rating: 4 },
    { suffix: "Risk Agent", seed: "risk", when: "Today, 09:38", rating: 1 },
    { suffix: "Sentiment Agent", seed: "sentiment", when: "Today, 09:36", rating: 3 },
    { suffix: "Earnings Agent", seed: "earnings", when: "Today, 09:34", rating: 2 },
];

export default function Stock() {
    const { symbol = "" } = useParams();
    const [params] = useSearchParams();
    const source = params.get("source") || "";
    const { colorMode } = useColorMode();
    const t = resolvedTheme(colorMode === "dark");

    const [state, setState] = useState<{ key: string; data: Overview | null; err: string } | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const key = `${symbol}|${source}`;
        const qs = new URLSearchParams({ period: "1y" });
        if (source) qs.set("source", source);
        fetch(`${API_BASE}/stocks/${encodeURIComponent(symbol)}/overview?${qs}`, { signal: controller.signal })
            .then((r) => {
                if (!r.ok) throw new Error("bad status");
                return r.json();
            })
            .then((d: Overview) => {
                if (!controller.signal.aborted) setState({ key, data: d, err: "" });
            })
            .catch((e: unknown) => {
                if (e instanceof DOMException && e.name === "AbortError") return;
                if (!controller.signal.aborted) setState({ key, data: null, err: "Couldn't load this stock." });
            });
        return () => controller.abort();
    }, [symbol, source]);

    // A previous symbol's state must never render under the new URL.
    const view = state && state.key === `${symbol}|${source}` ? state : null;
    if (view?.err) {
        return (
            <div className="min-h-full bg-[var(--surface-canvas)] py-24 text-center font-[family-name:var(--font-body)] text-sm text-[var(--ink-tertiary)]">
                {view.err}
            </div>
        );
    }
    if (!view?.data) {
        return (
            <div className="min-h-full bg-[var(--surface-canvas)]">
                <Center minH="50vh">
                    <Spinner size="lg" />
                </Center>
            </div>
        );
    }

    const d = view.data;
    const up = (d.change ?? 0) >= 0;
    const changeColor = up ? "var(--signal-positive)" : "var(--signal-negative)";
    const sign = up ? "+" : "−";
    const ltp = d.ltp_time ? new Date(d.ltp_time) : null;
    const ltpLabel = ltp
        ? ltp.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : "—";

    const stats = [
        { label: "Market cap", value: fmt(d.market_cap, d.currency, true) },
        { label: "P/E", value: fmt(d.pe, d.currency) },
        { label: "Prev close", value: fmt(d.prev_close, d.currency) },
        { label: "52W high", value: fmt(d.fifty_two_week_high, d.currency) },
        { label: "52W low", value: fmt(d.fifty_two_week_low, d.currency) },
        { label: "Volume", value: fmt(d.volume, d.currency, true) },
    ];

    const agents: AgentCellAgent[] = AGENT_SEEDS.map((a) => ({
        name: `${symbol} ${a.suffix}`,
        seed: `${symbol}-${a.seed}`,
        when: a.when,
        rating: RATINGS[a.rating],
    }));

    return (
        <div className="min-h-full bg-[var(--surface-canvas)] pb-16 text-[var(--ink-primary)]">
            {/* Section 1 — identity left, metrics + chart right */}
            <section className="pt-10">
                <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
                    {/* Left: logo, name, exchange */}
                    <div className="min-w-0 sm:w-[40%]">
                        <div className="flex items-center gap-4">
                            <TickerLogo symbol={symbol} size={88} />
                            <div className="min-w-0">
                                <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.75rem,3vw,2.5rem)] leading-tight font-normal text-[var(--ink-primary)]">
                                    {d.name || symbol}
                                </h1>
                                <p className="mt-1 font-[family-name:var(--font-body)] text-sm font-light text-[var(--ink-tertiary)]">
                                    {symbol}
                                    {d.exchange ? ` · ${d.exchange}` : ""}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Right: price, change, LTP, metrics + chart */}
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                            <span className="font-[family-name:var(--font-display)] text-[clamp(2rem,4vw,3rem)] leading-none font-normal text-[var(--ink-primary)]">
                                {fmtPrice(d.price, d.currency)}
                            </span>
                            <span className="font-[family-name:var(--font-body)] text-sm font-normal" style={{ color: changeColor }}>
                                {sign}
                                {fmt(Math.abs(d.change ?? 0), d.currency)} ({sign}
                                {Math.abs(d.change_pct ?? 0).toFixed(2)}%)
                            </span>
                            <span className="font-[family-name:var(--font-body)] text-xs font-light text-[var(--ink-tertiary)]">{d.currency}</span>
                        </div>
                        <p className="mt-2 font-[family-name:var(--font-body)] text-xs font-light text-[var(--ink-tertiary)]">
                            LTP · {fmtPrice(d.price, d.currency)} · {ltpLabel}
                        </p>

                        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
                            {stats.map((s) => (
                                <div key={s.label}>
                                    <dt className="font-[family-name:var(--font-body)] text-[11px] font-light tracking-wide text-[var(--ink-tertiary)] uppercase">
                                        {s.label}
                                    </dt>
                                    <dd className="mt-0.5 font-[family-name:var(--font-body)] text-[15px] font-normal text-[var(--ink-primary)]">
                                        {s.value}
                                    </dd>
                                </div>
                            ))}
                        </dl>

                        {/* Hoverable SVG chart of the last year */}
                        {d.candles.length > 1 && (
                            <div className="mt-8">
                                <p className="mb-2 font-[family-name:var(--font-body)] text-xs font-light tracking-wide text-[var(--ink-tertiary)] uppercase">
                                    Close · last {d.period}
                                </p>
                                <Echart
                                    height={260}
                                    ariaLabel={`Close price for ${symbol} over the last ${d.period}`}
                                    option={{
                                        grid: { left: 8, right: 12, top: 18, bottom: 28 },
                                        xAxis: {
                                            type: "category",
                                            data: d.candles.map((c) => c.date),
                                            boundaryGap: false,
                                            axisLine: { lineStyle: { color: t.hairline } },
                                            axisTick: { show: false },
                                            axisLabel: { color: t.ink.tertiary, fontSize: 11, margin: 10 },
                                        },
                                        yAxis: {
                                            type: "value",
                                            scale: true,
                                            splitLine: { lineStyle: { color: t.hairline, opacity: 0.6 } },
                                            axisLabel: { color: t.ink.tertiary, fontSize: 11 },
                                        },
                                        tooltip: {
                                            ...tooltipStyle(t),
                                            trigger: "axis",
                                            axisPointer: { type: "line", lineStyle: { color: t.hairline } },
                                            formatter: (params: unknown) => {
                                                const p = (
                                                    Array.isArray(params) ? params[0] : params
                                                ) as { axisValue: string; value: number };
                                                return `${p.axisValue} &nbsp; <b>${fmtPrice(p.value, d.currency)}</b>`;
                                            },
                                        },
                                        series: [
                                            {
                                                type: "line",
                                                data: d.candles.map((c) => c.close),
                                                showSymbol: false,
                                                lineStyle: { width: 1.5, color: t.chart[2] },
                                                areaStyle: { color: t.chart[2], opacity: 0.08 },
                                            },
                                        ],
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* Section 2 — agent runs (UI only for now) */}
            <section className="mt-12">
                <div className="mb-4 flex items-end justify-between gap-4">
                    <div>
                        <h2 className="font-[family-name:var(--font-display)] text-[clamp(1.5rem,2.5vw,2rem)] leading-tight font-normal text-[var(--ink-primary)]">
                            Agent Runs
                        </h2>
                        <p className="mt-1 font-[family-name:var(--font-body)] text-xs font-light text-[var(--ink-tertiary)]">
                            Agents currently covering {symbol}.
                        </p>
                    </div>
                    <Link
                        to="/analysis-list"
                        className="font-[family-name:var(--font-body)] text-xs font-normal whitespace-nowrap text-[#4A6E8E] underline-offset-2 transition-colors hover:text-[var(--ink-primary)] hover:underline cursor-pointer"
                    >
                        View all runs
                    </Link>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {agents.map((a) => (
                        <AgentCell key={a.name} agent={a} />
                    ))}
                </div>
            </section>
        </div>
    );
}
