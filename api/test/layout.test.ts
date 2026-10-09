import { describe, it, expect } from "vitest";
import {
  applyVisualFloor,
  buildDataManifest,
  buildFallbackLayout,
  buildPriceProfile,
  countVisuals,
  groundLang,
  langHasVisual,
  metricUnit,
  normalizeDatasets,
  normalizeMetrics,
  normalizeLang,
  manifestForPrompt,
  splitSections,
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

  it("unwraps named arrays from wrapper objects, at any nesting depth", () => {
    const datasets = normalizeDatasets([
      { tool: "get_income_statements", status: "ok", result: JSON.stringify({ symbol: "KEI", income_statements: [{ period: "Q1", revenue: 31850 }, { period: "Q2", revenue: 27260 }] }) },
      { tool: "get_balance_sheets", status: "ok", result: JSON.stringify({ data: { balance_sheets: [{ equity: 100, debt: 3 }] } }) },
      { tool: "get_financials", status: "ok", result: JSON.stringify({ symbol: "KEI", ocf: 8400 }) },
    ]);
    expect(datasets.map((d) => d.id)).toEqual(["obs_get_income_statements_0", "obs_get_balance_sheets_1"]);
    expect(datasets[0].label).toBe("get_income_statements: income_statements");
    expect(datasets[0].cols).toEqual(["period", "revenue"]);
    expect(datasets[1].label).toBe("get_balance_sheets: data.balance_sheets");
    expect(datasets[1].rows).toEqual([{ equity: 100, debt: 3 }]);
  });
});

describe("buildDataManifest", () => {
  it("is deterministic for identical inputs", () => {
    const a = buildDataManifest({ symbol: "KEI", shareName: "KEI", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02", outputs: [output()], totalScore: 71, coverage: 100 });
    const b = buildDataManifest({ symbol: "KEI", shareName: "KEI", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02", outputs: [output()], totalScore: 71, coverage: 100 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("keeps skill scores out of the manifest datasets", () => {
    const m = buildDataManifest({ symbol: "KEI", shareName: "KEI", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02", outputs: [output()], totalScore: 71, coverage: 100 });
    expect(m.datasets.some((d) => d.id === "score_skills")).toBe(false);
    // scores stay on the skills entries for prose/UI, never as chartable datasets
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
      '<PriceChart data="@ds:price_candles" ma20="@ds:price_sma20" />',
      '<MarkdownBlock skill="sku-moat" />',
      '</AnalysisPage>',
    ].join("");
    const r = groundLang(lang, m);
    expect(r.pass).toBe(true);
    expect(r.unresolved).toEqual([]);
  });

  it("flags score literals as unresolved — they are not layout material", () => {
    const r = groundLang('<StatHero value="@lit:score.totalScore" />', m);
    expect(r.unresolved).toContain("lit:score.totalScore");
  });

  it("flags unresolved references, and discards past the cap", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `<DataTable data="@ds:no_such_dataset_${i}" />`).join("");
    const r = groundLang(nine, m);
    expect(r.pass).toBe(false);
    expect(r.unresolved.length).toBe(9);
    expect(r.unresolved[0]).toBe("ds:no_such_dataset_0");
  });
});

describe("manifestForPrompt column profile", () => {
  it("marks numeric vs label columns and flags chartable datasets", () => {
    const m = manifest({
      datasets: [
        { id: "obs_t", label: "obs", kind: "table", cols: ["period", "revenue", "note"], rows: [
          { period: "Q1", revenue: 31850, note: "x" },
          { period: "Q2", revenue: 27260, note: "y" },
        ] },
        { id: "obs_one", label: "one row", kind: "table", cols: ["a"], rows: [{ a: 1 }] },
      ],
    });
    const pv = manifestForPrompt(m);
    const t = pv.datasets.find((d) => d.id === "obs_t")!;
    expect(t.numericCols).toEqual(["revenue"]);
    expect(t.labelCols).toEqual(["period", "note"]);
    expect(t.chartable).toBe(true);
    expect(pv.datasets.find((d) => d.id === "obs_one")!.chartable).toBe(false);
  });

  it("hides a constant label column so a chart cannot axis on the ticker", () => {
    const m = manifest({
      datasets: [
        { id: "obs_cf", label: "get_cash_flows: cash_flows", kind: "table", cols: ["symbol", "report_period", "operating"], rows: [
          { symbol: "KEI", report_period: "FY24", operating: 8_399_540_000 },
          { symbol: "KEI", report_period: "FY23", operating: 7_000_000_000 },
        ] },
      ],
    });
    expect(manifestForPrompt(m).datasets.find((d) => d.id === "obs_cf")!.labelCols).toEqual(["report_period"]);
  });
});

describe("deterministic visual floor", () => {
  const m = manifest({
    skills: [{ id: "sku-moat", name: "Moat", category: "qualitative", weight: 5, score: 84, sections: [{ id: "md_sku-moat_0", heading: "Moat", markdown: "# Moat\nProse." }] }],
    datasets: [
      { id: "price_candles", label: "Price history", kind: "series", cols: ["date", "close"], rows: [{ date: "2026-10-01", close: 5000 }, { date: "2026-10-02", close: 5100 }] },
      { id: "obs_income", label: "Income", kind: "table", cols: ["period", "revenue"], rows: [{ period: "Q1", revenue: 31850 }, { period: "Q2", revenue: 27260 }] },
    ],
  });

  it("detects visuals and counts them", () => {
    expect(langHasVisual('root = AnalysisPage("KEI", [MarkdownBlock("sku-moat")])')).toBe(false);
    expect(langHasVisual('root = AnalysisPage("KEI", [PriceChart("@ds:price_candles"), BarChart("@ds:obs_income", "period", "revenue", "Income")])')).toBe(true);
    expect(countVisuals('root = AnalysisPage("KEI", [StatHero("L", "@lit:price.lastPrice"), DataTable("@ds:obs_income", 12)])')).toBe(2);
  });

  it("builds a grounded layout from manifest ids only", () => {
    const lang = buildFallbackLayout(m)!;
    expect(lang).not.toBeNull();
    expect(validateLangStructure(lang)).toEqual({ ok: true });
    expect(groundLang(lang, m).pass).toBe(true);
    expect(lang).toContain('BarChart("@ds:obs_income", "period", "revenue", "Income")');
  });

  it("returns null when there is nothing chartable", () => {
    expect(buildFallbackLayout(manifest({ price: null, datasets: [] }))).toBeNull();
  });

  it("labels the fallback bar chart with a varying column, never the ticker", () => {
    const lang = buildFallbackLayout(manifest({
      price: null,
      datasets: [
        { id: "obs_cf", label: "Cash flows", kind: "table", cols: ["symbol", "report_period", "operating"], rows: [
          { symbol: "KEI", report_period: "FY24", operating: 8_399_540_000 },
          { symbol: "KEI", report_period: "FY23", operating: 7_000_000_000 },
        ] },
      ],
    }))!;
    expect(lang).toContain('BarChart("@ds:obs_cf", "report_period", "operating"');
  });

  it("keeps a model layout that interleaves prose sections and figures", () => {
    const model = 'root = AnalysisPage("KEI", [MarkdownBlock("@md:md_sku-moat_0"), PriceChart("@ds:price_candles")])';
    expect(applyVisualFloor(model, m)).toEqual({ lang: model, source: "model" });
  });

  it("overrides a model layout that tables data it could have charted", () => {
    const model = 'root = AnalysisPage("KEI", [MarkdownBlock("@md:md_sku-moat_0"), PriceChart("@ds:price_candles"), DataTable("@ds:obs_income", 12)])';
    const r = applyVisualFloor(model, m);
    expect(r.source).toBe("deterministic");
    expect(r.lang).toContain('BarChart("@ds:obs_income"');
  });

  it("charts a headline metric, never the numeric id column", () => {
    const lang = buildFallbackLayout(manifest({
      price: null,
      datasets: [
        { id: "obs_income", label: "Income", kind: "table", cols: ["id", "period_end_date", "revenue_from_operations", "total_assets"], rows: [
          { id: 1, period_end_date: "2025-03-31", revenue_from_operations: 31853420000, total_assets: 500 },
          { id: 2, period_end_date: "2025-06-30", revenue_from_operations: 27260000000, total_assets: 520 },
        ] },
      ],
    }))!;
    expect(lang).toContain('BarChart("@ds:obs_income", "period_end_date", "revenue_from_operations"');
  });

  it("overrides a visual model layout that dumps figures after all the prose", () => {
    const model = 'root = AnalysisPage("KEI", [MarkdownBlock("sku-moat"), PriceChart("@ds:price_candles")])';
    const r = applyVisualFloor(model, m);
    expect(r.source).toBe("deterministic");
    expect(r.lang).toContain("MarkdownBlock(\"@md:");
  });

  it("replaces a prose-only model layout with the deterministic floor", () => {
    const prose = 'root = AnalysisPage("KEI", [MarkdownBlock("sku-moat")])';
    const r = applyVisualFloor(prose, m);
    expect(r.source).toBe("deterministic");
    expect(langHasVisual(r.lang!)).toBe(true);
  });
});

describe("metric groups", () => {
  const flatObs = (tool: string, obj: Record<string, unknown>): SkillRawObservation => ({
    tool,
    status: "ok",
    result: JSON.stringify(obj),
  });

  it("captures a flat scalar group and infers units from the key names", () => {
    const out = normalizeMetrics([
      flatObs("get_financial_metrics", {
        ebitda_margin: 12.2,
        net_margin: 8.08,
        debt_to_equity: 0.0279,
        return_on_equity: 14.96,
        current_price: 4580,
        fetched_at: "2026-10-02T18:12:27Z",
      }),
    ], "sku-growth");
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("met_get_financial_metrics_0");
    expect(out[0].label).toBe("financial metrics");
    expect(out[0].ownerSkill).toBe("sku-growth");
    const unit = (k: string) => out[0].fields.find((f) => f.key === k)!.unit;
    expect(unit("net_margin")).toBe("pct");
    expect(unit("debt_to_equity")).toBe("x");
    expect(unit("return_on_equity")).toBe("pct");
    expect(unit("current_price")).toBe("cur");
  });

  it("skips tiny groups, metadata-only results, and dedupes a repeated tool", () => {
    const two = flatObs("get_ratios", { a: 1, b: 2 });
    const dup = flatObs("get_financial_metrics", { net_margin: 8, gross_margin: 30, op_margin: 20 });
    const out = normalizeMetrics([two, dup, { ...dup }]);
    expect(out.length).toBe(1); // the 3-key group survives once; the 2-key group is metadata
  });

  it("assigns a metric group to the prose section that names its metric", () => {
    const m = buildDataManifest({
      symbol: "KEI", shareName: "KEI", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02",
      outputs: [output({
        skill_id: "sku-growth",
        analysis: "# Revenue\nA.\n\n## Margins\nB.",
        raw_observations: [flatObs("get_financial_metrics", { net_margin: 8, operating_margin: 12, gross_margin: 30 })],
      })],
      totalScore: 71, coverage: 100,
    });
    expect(m.datasets.some((d) => d.id.startsWith("obs_"))).toBe(false); // flat scalars are not a table
    expect(m.metrics.length).toBe(1);
    expect(m.metrics[0].ownerSection).toBe("md_sku-growth_1"); // "Margins"
  });

  it("hides metric values from the prompt but keeps ids and field keys", () => {
    const m = manifest({
      metrics: [{ id: "met_x_0", label: "ratios", ownerSkill: "sku-moat", fields: [
        { key: "net_margin", label: "net margin", value: 8.08, unit: "pct" },
        { key: "debt_to_equity", label: "debt to equity", value: 0.03, unit: "x" },
      ] }],
    });
    const pv = manifestForPrompt(m);
    expect(pv.metrics![0].fields).toEqual([]);
    expect(pv.metrics![0].keys).toEqual(["net_margin", "debt_to_equity"]);
  });

  it("grounds @mt refs and flags an unknown metric id", () => {
    const m = manifest({ metrics: [{ id: "met_x_0", label: "ratios", fields: [] }] });
    expect(groundLang('root = AnalysisPage("KEI", [MetricGrid("@mt:met_x_0")])', m).pass).toBe(true);
    expect(groundLang('root = AnalysisPage("KEI", [MetricGrid("@mt:nope")])', m).unresolved).toContain("mt:nope");
  });

  it("emits a MetricGrid in the fallback when a skill has only a metric group", () => {
    const m = manifest({
      price: null,
      datasets: [],
      skills: [{ id: "sku-moat", name: "Moat", category: "qualitative", weight: 5, score: 84, sections: [
        { id: "md_sku-moat_0", heading: "Margins", markdown: "Prose." },
      ] }],
      metrics: [{ id: "met_x_0", label: "ratios", ownerSkill: "sku-moat", ownerSection: "md_sku-moat_0", fields: [
        { key: "net_margin", label: "net margin", value: 8, unit: "pct" },
      ] }],
    });
    const lang = buildFallbackLayout(m)!;
    expect(lang).not.toBeNull();
    expect(lang).toContain('MetricGrid("@mt:met_x_0")');
    expect(validateLangStructure(lang)).toEqual({ ok: true });
    expect(groundLang(lang, m).pass).toBe(true);
  });
});

describe("splitSections", () => {
  it("splits prose at markdown headings", () => {
    const secs = splitSections("# Moat\nFirst.\n\n## Pricing power\nSecond.\n\n## Moat trend\nThird.", "sku-moat");
    expect(secs.map((s) => s.id)).toEqual(["md_sku-moat_0", "md_sku-moat_1", "md_sku-moat_2"]);
    expect(secs[1].heading).toBe("Pricing power");
    expect(secs[0].markdown).toContain("First.");
  });

  it("falls back to paragraph chunks when there are no headings", () => {
    const secs = splitSections("One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.\n\nSix.", "sku-x");
    expect(secs.length).toBeGreaterThan(1);
    expect(secs.every((s) => s.id.startsWith("md_sku-x_"))).toBe(true);
  });

  it("returns nothing for empty prose", () => {
    expect(splitSections("", "sku-x")).toEqual([]);
  });
});

describe("sectioned fallback", () => {
  it("round-robins a skill's figures across its prose sections", () => {
    const m = buildDataManifest({
      symbol: "KEI", shareName: "KEI", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02",
      outputs: [output({
        skill_id: "sku-growth",
        analysis: "# Growth\nA.\n\n## Trend\nB.\n\n## Outlook\nC.",
        raw_observations: [
          tableObs("get_financial_metrics", [{ period: "Q1", revenue: 1 }, { period: "Q2", revenue: 2 }]),
          tableObs("get_news_sentiment", [{ topic: "a", articles: 3 }, { topic: "b", articles: 5 }]),
        ],
      })],
      totalScore: 71, coverage: 100,
    });
    const figs = m.datasets.filter((d) => d.ownerSkill === "sku-growth");
    expect(figs.length).toBe(2);
    expect(figs[0].ownerSection).toBe("md_sku-growth_0");
    expect(figs[1].ownerSection).toBe("md_sku-growth_1");
  });

  it("interleaves each section's prose with its figure inside the layout", () => {
    const m = buildDataManifest({
      symbol: "KEI", shareName: "KEI", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02",
      outputs: [output({
        skill_id: "sku-growth",
        analysis: "# Growth\nA.\n\n## Trend\nB.",
        raw_observations: [tableObs("get_financial_metrics", [{ period: "Q1", revenue: 1 }, { period: "Q2", revenue: 2 }])],
      })],
      totalScore: 71, coverage: 100,
    });
    const lang = buildFallbackLayout(m)!;
    expect(validateLangStructure(lang)).toEqual({ ok: true });
    expect(groundLang(lang, m).pass).toBe(true);
    const s0 = lang.indexOf('MarkdownBlock("@md:md_sku-growth_0")');
    const fig = lang.indexOf('BarChart("@ds:obs_get_financial_metrics_0"');
    const s1 = lang.indexOf('MarkdownBlock("@md:md_sku-growth_1")');
    expect(s0).toBeGreaterThanOrEqual(0);
    expect(s0).toBeLessThan(fig); // section 0 prose before its figure
    expect(fig).toBeLessThan(s1); // ...and before the next section's prose
  });

  it("keeps section markdown out of the prompt view but keeps ids and headings", () => {
    const m = manifest({
      skills: [{ id: "sku-moat", name: "Moat", category: "qualitative", weight: 5, score: 84, markdown: "# Moat\nProse.", sections: [{ id: "md_sku-moat_0", heading: "Moat", markdown: "# Moat\nProse." }] }],
    });
    const pv = manifestForPrompt(m);
    const secs = pv.skills[0].sections!;
    expect(secs[0].id).toBe("md_sku-moat_0");
    expect(secs[0].heading).toBe("Moat");
    expect(secs[0].markdown).toBe("");
  });
});

describe("skill attribution + interleaved fallback", () => {
  it("tags generic datasets with the skill that captured them; price stays global", () => {
    const m = buildDataManifest({
      symbol: "KEI", shareName: "KEI", source: "NSE", agentName: "Sid", runMode: "agent", asOf: "2026-10-02",
      outputs: [output({ skill_id: "sku-growth", raw_observations: [priceHistory(), tableObs("get_financial_metrics", [{ period: "Q1", revenue: 1 }, { period: "Q2", revenue: 2 }])] })],
      totalScore: 71, coverage: 100,
    });
    expect(m.datasets.find((d) => d.id === "price_candles")!.ownerSkill).toBeUndefined();
    expect(m.datasets.find((d) => d.id === "obs_get_financial_metrics_0")!.ownerSkill).toBe("sku-growth");
  });

  it("keeps ownerSkill in the prompt-sized view", () => {
    const m = manifest({
      datasets: [{ id: "obs_x", label: "x", kind: "table", cols: ["a"], rows: [{ a: 1 }, { a: 2 }], ownerSkill: "sku-moat" }],
    });
    expect(manifestForPrompt(m).datasets.find((d) => d.id === "obs_x")!.ownerSkill).toBe("sku-moat");
  });

  it("interleaves each skill's prose with its own figure, header first", () => {
    const m = manifest({
      skills: [
        { id: "sku-moat", name: "Moat", category: "qualitative", weight: 5, score: 84 },
        { id: "sku-growth", name: "Growth", category: "fundamentals", weight: 5, score: 70 },
      ],
      datasets: [
        { id: "obs_a", label: "A", kind: "table", cols: ["period", "revenue"], rows: [{ period: "Q1", revenue: 1 }, { period: "Q2", revenue: 2 }], ownerSkill: "sku-moat" },
        { id: "obs_b", label: "B", kind: "table", cols: ["period", "revenue"], rows: [{ period: "Q1", revenue: 3 }, { period: "Q2", revenue: 4 }], ownerSkill: "sku-growth" },
      ],
    });
    const lang = buildFallbackLayout(m)!;
    const iA = lang.indexOf('MarkdownBlock("sku-moat")');
    const cA = lang.indexOf('BarChart("@ds:obs_a"');
    const iB = lang.indexOf('MarkdownBlock("sku-growth")');
    const cB = lang.indexOf('BarChart("@ds:obs_b"');
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iA).toBeLessThan(cA); // moat prose before moat's chart
    expect(cA).toBeLessThan(iB); // moat's section before growth's
    expect(iB).toBeLessThan(cB);
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