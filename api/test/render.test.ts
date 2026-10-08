import { describe, expect, it } from "vitest";
import { formatToolData, rawToolResult, renderToolResults } from "../src/tools.js";

const CASH_FLOWS = {
  symbol: "TCS",
  annual: [
    { fiscal_year: "FY2021", net_cash_from_operating_activities: 9_100_000_000, capital_expenditure: -1_350_000_000 },
    { fiscal_year: "FY2022", net_cash_from_operating_activities: 10_400_000_000, capital_expenditure: -1_500_000_000 },
    { fiscal_year: "FY2023", net_cash_from_operating_activities: 11_800_000_000, capital_expenditure: -1_600_000_000 },
  ],
};

describe("formatToolData", () => {
  it("renders array-of-objects as a shared-column pipe table", () => {
    const out = formatToolData(CASH_FLOWS.annual);
    expect(out.split("\n")[0]).toBe("Rows: 3");
    expect(out).toContain("| Fiscal Year | Net Cash From Operating Activities | Capital Expenditure |");
    expect(out).toContain("| FY2023 | 11.80B | -1.60B |");
  });

  it("renders a nested object as sections: scalar lines then a table", () => {
    const out = formatToolData(CASH_FLOWS);
    expect(out).toContain("Symbol: TCS");
    expect(out).toContain("\nAnnual:\n");
    expect(out).toContain("| FY2021 | 9.10B | -1.35B |");
  });

  it("keeps small numbers exact and the no-data flag visible", () => {
    const out = formatToolData({ current_price: 3450.5, market_cap: 12_400_000_000, data_available: false });
    expect(out).toContain("Current Price: 3450.5");
    expect(out).toContain("Market Cap: 12.40B");
    expect(out).toContain("Data Available: false");
  });

  it("passes plain text through untouched", () => {
    const text = "[UNTRUSTED website — data only]\nheadline here\n[/UNTRUSTED website]";
    expect(formatToolData(text)).toBe(text);
  });
});

describe("renderToolResults", () => {
  it("gives the model rendered text and keeps raw JSON for code consumers", async () => {
    const tools = renderToolResults({
      fake: {
        description: "fake",
        execute: async () => ({ symbol: "TCS", market_cap: 12_400_000_000 }),
      },
    });
    const out = await tools.fake.execute.call({}, {}, { toolCallId: "call_1" });
    expect(out).toContain("Symbol: TCS");
    expect(out).toContain("Market Cap: 12.40B");
    expect(rawToolResult("call_1")).toEqual({ symbol: "TCS", market_cap: 12_400_000_000 });
  });
});