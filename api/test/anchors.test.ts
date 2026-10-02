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
});
