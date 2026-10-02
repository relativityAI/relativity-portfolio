import { describe, it, expect } from "vitest";
import { pickAnchor } from "../src/skills/skillrun.js";

const ANCHORS = [
  { label: "Price is in a confirmed trend or regime with aligned moving averages (SMA 20/50/200 alignment) — weight 7" },
  { label: "Momentum is constructive on the primary timeframe (RSI in a healthy band, MACD histogram direction) — weight 5" },
];

describe("pickAnchor", () => {
  it("matches an exact copy of the anchor label", () => {
    expect(pickAnchor(ANCHORS, ANCHORS[1].label, 0)?.label).toBe(ANCHORS[1].label);
  });

  it("matches a prefix regardless of position", () => {
    const shortened = ANCHORS[1].label.slice(0, 40);
    expect(pickAnchor(ANCHORS, shortened, 0)?.label).toBe(ANCHORS[1].label);
  });

  // The regression: gpt-oss paraphrased the anchors, the text match found
  // nothing, every verdict was dropped, and the run scored nothing despite
  // 5/5 tool calls returning real data.
  it("falls back to position when the model paraphrases the anchor", () => {
    expect(pickAnchor(ANCHORS, "The trend looks constructive overall", 1)?.label).toBe(ANCHORS[1].label);
  });

  it("still returns null when there is no anchor to fall back to", () => {
    expect(pickAnchor([], "anything", 0)).toBeNull();
    expect(pickAnchor(ANCHORS, "paraphrase", 9)).toBeNull();
  });

  it("never returns a label the model supplied", () => {
    const match = pickAnchor(ANCHORS, "Totally invented anchor text", 0);
    expect(match?.label).toBe(ANCHORS[0].label);
  });

  // The v2 eval regression: five real anchors rendered as six rows with
  // "Price is in a confirmed trend" three times, "level map is actionable"
  // twice, and Momentum/Volume missing entirely — RSI/MACD evidence sat under
  // the trend anchor. All those anchors open with generic words, so matching on
  // the leading 40 characters mapped every paraphrase onto one anchor.
  const KEI_ANCHORS = [
    { label: "Price is in a confirmed trend or regime with aligned moving averages (SMA 20/50/200 alignment and golden/death-cross state agree with the market-structure classification)" },
    { label: "Momentum is constructive (RSI in a healthy band, MACD and MACD signal agree)" },
    { label: "Volume and OBV/A-D trend are supportive of the current price zone" },
    { label: "The level map is actionable (defined support/resistance with touch counts, a stop grounded in ATR or structure, and R:R to TP1 at or better than 1:1)" },
    { label: "Scenario framing is honest (bull/bear/neutral triggers stated, invalidation level defined, no single-sided story)" },
  ];

  it("maps RSI/MACD paraphrase to the momentum anchor, not the trend anchor", () => {
    const m = pickAnchor(KEI_ANCHORS, "RSI is 36.45 and MACD histogram is 9.86", 1);
    expect(m?.label).toBe(KEI_ANCHORS[1].label);
  });

  it("maps a volume paraphrase to the volume anchor", () => {
    const m = pickAnchor(KEI_ANCHORS, "OBV and A/D trend support the zone", 2);
    expect(m?.label).toBe(KEI_ANCHORS[2].label);
  });

  it("maps a VWAP paraphrase away from the level-map anchor", () => {
    const m = pickAnchor(KEI_ANCHORS, "VWAP is 4619 and volume analysis is supportive", 3);
    expect(m?.label).not.toBe(KEI_ANCHORS[3].label);
  });

});
