import { describe, it, expect } from "vitest";
import {
  buildDataManifest,
  buildPriceProfile,
  groundLang,
  normalizeDatasets,
  normalizeLang,
  manifestForPrompt,
  validateLangStructure,
  type LayoutManifest,
} from "../src/layout.js";
import type { SkillOutput, SkillRawObservation } from "../src/skills/types.js";

function priceHistory(over: Partial<Record<string, unknown>> = {}): SkillRawObservation {
  return {
    tool: "get_price_history",
    status: "ok",
    result: JSON.stringify({
      candles_recent: Array.from({ length: 270 }, (_, i) => ({
        date: `2026-0${1 + (i % 9)}-${String(1 + i).padStart(2, "0")}`,
        c: 5000 + i,
        v: 1_000_000,
      })),
      sma20: [{ date: "2026-09-30", value: 5100 }],
      sma50: [{ date: "2026-09-30", value: 5200 }],
      sma200: [{ date: "2026-09-30", value: 4800 }],
      rsi14: [{ date: "2026-09-30", value: 45 }],
      fifty_two_week: { high: 6100, low: 4100 },
      fetched_at: "2026-10-02T18:12:27Z",
      ...over,
    }),
  };
}

function tableObs(tool: string, rows: Record<string, unknown>[]): SkillRawObservation {
  return { tool, status: "ok", result: JSON.stringify(rows) };
}

function output(over: Partial<SkillOutput> = {}): SkillOutput {
  return {
    skill_id: "sku-moat",
    skill_name: "Moat",
    category: "qualitative",
    weight: 5,
    findings: [],
    verdicts: [],
    tools_used: ["get_price_history"],
    citations: [],
    raw_observations: [priceHistory()],
    scored_by: "llm",
    analysis: "# Moat\nProse.",
    score_0_100: 84,
    coverage: 100,
    anchor_count: 2,
    ...over,
  };
}

function manifest(over: Partial<LayoutManifest> = {}): LayoutManifest {
  return {
    api: 1,
    identity: { symbol: "KEI", shareName: "KEI Industries", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02" },
    score: { totalScore: 71, coverage: 100 },
    skills: [{ id: "sku-moat", name: "Moat", category: "qualitative", weight: 5, score: 84 }],
    price: {
      lastPrice: 5269,
      week52Low: 4100,
      week52High: 6100,
      asOf: "2026-10-02",
      rsi14: 45,
      sma20: 5100,
      sma50: 5200,
      sma200: 4800,
      returns: {},
    },
    datasets: [
      { id: "price_candles", label: "Price history", kind: "series", cols: ["date", "close", "volume"], rows: [] },
      { id: "price_sma20", label: "SMA20", kind: "series", cols: ["date", "value"], rows: [] },
      { id: "score_skills", label: "Skill scores", kind: "table", cols: ["id", "name", "category", "weight", "score"], rows: [] },
    ],
    ...over,
  };
}

describe("buildPriceProfile", () => {
  it("pulls last price, SMA/RSI series and 52w range from get_price_history", () => {
    const { price, datasets } = buildPriceProfile([priceHistory()]);
    expect(price?.lastPrice).toBe(5269);
    expect(price?.week52High).toBe(6100);
    expect(price?.week52Low).toBe(4100);
    expect(price?.asOf).toBe("2026-10-02");
    expect(price?.sma20).toBe(5100);
    expect(price?.sma200).toBe(4800);
    expect(price?.rsi14).toBe(45);
    const ids = datasets.map((d) => d.id);
    expect(ids).toEqual(["price_candles", "price_sma20", "price_sma50", "price_sma200", "price_rsi14"]);
    expect(datasets[0].kind).toBe("series");
    expect(datasets[0].rows.length).toBe(260);
  });

  it("falls back to get_current_price scalars, including returns", () => {
    const { price, datasets } = buildPriceProfile([
      {
        tool: "get_current_price",
        status: "ok",
        result: JSON.stringify({ price: 4502, week52_high: 6100, asOf: "2026-10-02", returns: { ytd: 12.4, "1y": -3.1 } }),
      },
    ]);
    expect(price?.lastPrice).toBe(4502);
    expect(price?.week52High).toBe(6100);
    expect(price?.returns).toEqual({ ytd: 12.4, "1y": -3.1 });
    expect(datasets).toEqual([]);
  });

  it("returns null price when there is no price data at all", () => {
    expect(buildPriceProfile([]).price).toBeNull();
  });
});

describe("normalizeDatasets", () => {
  it("builds generic tables, skipping ERR rows and price tools", () => {
    const datasets = normalizeDatasets([
      priceHistory(),
      tableObs("get_financial_metrics", [
        { revenue_cr: 12000, fcf_cr: 1800 },
        { revenue_cr: 14000, fcf_cr: 2100 },
      ]),
      tableObs("get_news_sentiment", [{ headline: "x".repeat(300), score: -0.4 }]),
      { tool: "get_blog_posts", status: "ERR", result: "{}" },
    ]);
    const ids = datasets.map((d) => d.id);
    expect(ids).toEqual(["obs_get_financial_metrics_0", "obs_get_news_sentiment_1"]);
    expect(datasets[0].rows).toEqual([
      { revenue_cr: 12000, fcf_cr: 1800 },
      { revenue_cr: 14000, fcf_cr: 2100 },
    ]);
    // cells are capped at MAX_CELL_CHARS, so the 300-char headline is truncated
    expect((datasets[1].rows[0] as { headline: string }).headline.length).toBeLessThan(300);
  });
});

describe("buildDataManifest", () => {
  it("is deterministic for identical inputs", () => {
    const a = buildDataManifest({ symbol: "KEI", shareName: "KEI", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02", outputs: [output()], totalScore: 71, coverage: 100 });
    const b = buildDataManifest({ symbol: "KEI", shareName: "KEI", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02", outputs: [output()], totalScore: 71, coverage: 100 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("always carries the deterministically-built score_skills dataset", () => {
    const m = buildDataManifest({ symbol: "KEI", shareName: "KEI", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02", outputs: [output()], totalScore: 71, coverage: 100 });
    const ds = m.datasets.find((d) => d.id === "score_skills");
    expect(ds?.rows).toEqual([{ id: "sku-moat", name: "Moat", category: "qualitative", weight: 5, score: 84 }]);
    expect(m.skills[0].score).toBe(84);
  });

  it("drops every dataset's rows from the prompt-sized view but keeps cols", () => {
    const m = manifest({
      datasets: [
        { id: "price_candles", label: "Price history", kind: "series", cols: ["date", "close"], rows: [{ date: "2026-10-01", close: 5000 }] },
        { id: "obs_t", label: "obs", kind: "table", cols: ["a", "b"], rows: [{ a: 1, b: "x" }, { a: 2, b: "y" }] },
      ],
    });
    const promptView = manifestForPrompt(m);
    expect(promptView.datasets.every((d) => d.rows.length === 0)).toBe(true);
    expect(promptView.datasets.find((d) => d.id === "obs_t")!.cols).toEqual(["a", "b"]);
  });
});

describe("groundLang", () => {
  const m = manifest();

  it("passes when every @ds/@lit reference resolves", () => {
    const lang = [
      '<AnalysisPage>',
      '<StatHero price="@lit:price.lastPrice" label="@lit:price.asOf" />',
      '<StatHero value="@lit:score.totalScore" />',
      '<PriceChart data="@ds:price_candles" ma20="@ds:price_sma20" />',
      '<SkillScoreCard data="@ds:score_skills" />',
      '<MarkdownBlock skill="sku-moat" />',
      '</AnalysisPage>',
    ].join("");
    const r = groundLang(lang, m);
    expect(r.pass).toBe(true);
    expect(r.unresolved).toEqual([]);
  });

  it("flags unresolved references, and discards past the cap", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `<DataTable data="@ds:no_such_dataset_${i}" />`).join("");
    const r = groundLang(nine, m);
    expect(r.pass).toBe(false);
    expect(r.unresolved.length).toBe(9);
    expect(r.unresolved[0]).toBe("ds:no_such_dataset_0");
  });
});

const VALID_LANG =
  'root = AnalysisPage("KEI", [StatHero("Last", "@lit:price.lastPrice"), PriceChart("@ds:price_candles"), MarkdownBlock("sku-moat")])';
const UNBOUND_LANG = VALID_LANG.replace("root = ", "");

describe("normalizeLang", () => {
  it("strips a code fence and preamble", () => {
    expect(normalizeLang('```\n' + VALID_LANG + '\n```')).toBe(VALID_LANG);
    expect(normalizeLang('Here is the layout:\n' + VALID_LANG)).toBe(VALID_LANG);
  });

  it("leaves clean output untouched", () => {
    expect(normalizeLang(VALID_LANG)).toBe(VALID_LANG);
  });

  it("binds a bare root call so the parser renders it", () => {
    expect(normalizeLang(UNBOUND_LANG)).toBe(VALID_LANG);
  });
});

describe("validateLangStructure", () => {
  it("accepts a well-formed layout", () => {
    expect(validateLangStructure(VALID_LANG)).toEqual({ ok: true });
  });

  it("rejects an unbound root", () => {
    const r = validateLangStructure(UNBOUND_LANG);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("root");
  });

  it("rejects XML-ish tags", () => {
    const r = validateLangStructure('<AnalysisPage "KEI" [ <StatHero "Last" /> ]>');
    expect(r.ok).toBe(false);
  });

  it("rejects unbalanced delimiters", () => {
    expect(validateLangStructure('root = AnalysisPage("KEI", [StatHero("x")]').error).toBe("unbalanced parentheses");
    expect(validateLangStructure('root = AnalysisPage("KEI", [StatHero("x"))').error).toBe("unbalanced brackets");
  });

  it("rejects unknown components", () => {
    const r = validateLangStructure('root = AnalysisPage("KEI", [MagicChart("@ds:price_candles")])');
    expect(r.ok).toBe(false);
    expect(r.error).toContain("MagicChart");
  });

  it("rejects a missing or nested-extra root", () => {
    expect(validateLangStructure('StatHero("x")').error).toContain("root");
    const two = 'root = AnalysisPage("KEI", [AnalysisPage("X", [])])';
    expect(validateLangStructure(two).error).toContain("exactly one AnalysisPage");
  });

  it("does not treat names inside strings as calls", () => {
    expect(validateLangStructure('root = AnalysisPage("FooBar(", [StatHero("Fake(")])').ok).toBe(true);
  });
});