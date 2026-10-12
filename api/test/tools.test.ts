import { describe, it, expect } from "vitest";
import { buildTools, projectSections } from "../src/tools.js";
import { VoyagerClient } from "../src/voyager.js";

const sample = {
  as_of: "2026-01-01",
  sections: {
    trend_analysis: { status: "ok", data: [1] },
    momentum_analysis: { status: "ok", data: [2] },
    volume_analysis: { status: "unavailable", data: null },
  },
};

describe("projectSections", () => {
  it("keeps only the requested sections and preserves other top-level keys", () => {
    expect(projectSections(sample, "trend_analysis, volume_analysis")).toEqual({
      as_of: "2026-01-01",
      sections: {
        trend_analysis: { status: "ok", data: [1] },
        volume_analysis: { status: "unavailable", data: null },
      },
    });
  });

  it("returns the payload unchanged when no names are requested", () => {
    expect(projectSections(sample)).toBe(sample);
    expect(projectSections(sample, "")).toBe(sample);
    expect(projectSections(sample, "  ,  ")).toBe(sample);
  });

  it("drops unknown names and tolerates a payload with no sections", () => {
    expect(projectSections(sample, "nope")).toEqual({ as_of: "2026-01-01", sections: {} });
    expect(projectSections({ as_of: "x" } as any, "trend_analysis")).toEqual({ as_of: "x" });
  });
});

describe("get_announcements schema", () => {
  const tools = () =>
    buildTools({
      voyager: new VoyagerClient("http://localhost", "test-key", 1),
      symbol: "RELIANCE",
      country: "in",
      source: "NSE",
      shareName: "Reliance",
    } as any);

  it("accepts the API's market segment enum but rejects a country code", () => {
    const schema = tools().get_announcements.inputSchema as any;
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ market: "equities" }).success).toBe(true);
    expect(schema.safeParse({ market: "sme" }).success).toBe(true);
    // Regression: the model used to send a country code, which the API 422s.
    expect(schema.safeParse({ market: "in" }).success).toBe(false);
  });
});

describe("read_latest_transcript", () => {
  const mkTools = (host: string) =>
    buildTools({
      voyager: {
        get: async (path: string) =>
          path === "/documents/index"
            ? { id: 12, url: `${host}/newest.pdf`, doc_title: "Q2 FY26", num_pages: 2, page_index: { structure: [{ title: "Results", start_index: 1, end_index: 2, nodes: [] }] }, cached: true }
            : path === "/documents/pages"
              ? { pages: [1, 2], text: [{ page: 1, text: "hello" }, { page: 2, text: "world" }] }
              : {
                  announcements: [
                    { date: "2026-03-01", heading: "Transcript of earnings call Q4", category: "Analyst meet", attachment: `${host}/newest.pdf` },
                    { date: "2026-01-01", heading: "Transcript of earnings call Q3", category: "Analyst meet", attachment: `${host}/older.pdf` },
                    { date: "2025-11-01", heading: "Investor presentation", category: "Presentation", attachment: `${host}/pres.pdf` },
                  ],
                },
      },
      symbol: "RELIANCE",
      country: "in",
      source: "NSE",
      shareName: "Reliance",
    } as any);

  it("lists the last k transcript URLs and degrades gracefully when the PDF can't be read", async () => {
    const schema = mkTools("https://example.com").read_latest_transcript.inputSchema as any;
    expect(schema.safeParse({ count: 2 }).success).toBe(true);
    expect(schema.safeParse({ count: 0 }).success).toBe(false);

    // example.com is not on the allowlist, so the read throws — the URL list must still come back.
    const out: any = await mkTools("https://example.com").read_latest_transcript.execute({ count: 2 } as any, {} as any);
    expect(out.documents.map((d: any) => d.url)).toEqual([
      "https://example.com/newest.pdf",
      "https://example.com/older.pdf",
    ]);
    expect(out.message).toContain("Could not read");
  });

  it("reads the newest transcript through Voyager /documents/index and joins the page text", async () => {
    const out: any = await mkTools("https://nsearchives.nseindia.com").read_latest_transcript.execute({ count: 1 } as any, {} as any);
    expect(out.url).toBe("https://nsearchives.nseindia.com/newest.pdf");
    expect(out.text).toContain("hello");
    expect(out.text).toContain("world");
  });

  it("reads the newest presentation through Voyager /documents/index too", async () => {
    const out: any = await mkTools("https://nsearchives.nseindia.com").read_latest_presentation.execute({ count: 1 } as any, {} as any);
    expect(out.url).toBe("https://nsearchives.nseindia.com/pres.pdf");
    expect(out.text).toContain("hello");
  });

  it("get_document_index returns the PageIndex tree with node page ranges", async () => {
    const out: any = await mkTools("https://nsearchives.nseindia.com").get_document_index.execute({ url: "https://nsearchives.nseindia.com/newest.pdf" } as any, {} as any);
    expect(out.doc_title).toBe("Q2 FY26");
    expect(out.num_pages).toBe(2);
    expect(out.page_index.structure[0]).toMatchObject({ title: "Results", start_index: 1, end_index: 2 });
  });

  it("read_document_pages reads only the requested pages", async () => {
    const out: any = await mkTools("https://nsearchives.nseindia.com").read_document_pages.execute({ url: "https://nsearchives.nseindia.com/newest.pdf", pages: "1-2" } as any, {} as any);
    expect(out.pages).toEqual([1, 2]);
    expect(out.text.map((t: any) => t.text)).toEqual(["hello", "world"]);
  });
});
