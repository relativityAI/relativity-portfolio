import { describe, expect, it } from "vitest";
import { rawToolResult, renderToolResults } from "../src/tools.js";

describe("renderToolResults", () => {
  it("returns rendered tool data and keeps raw JSON for code consumers", async () => {
    const tools = renderToolResults({
      fake: {
        description: "fake",
        execute: async () => ({ symbol: "TCS", market_cap: 12_400_000_000 }),
      },
    });
    const out = await tools.fake.execute.call({}, {}, { toolCallId: "call_1" });
    expect(out).toBe(JSON.stringify({ symbol: "TCS", market_cap: 12_400_000_000 }));
    expect(rawToolResult("call_1")).toEqual({ symbol: "TCS", market_cap: 12_400_000_000 });
  });
});
