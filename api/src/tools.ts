import { z } from "zod";
import { tool } from "ai";
import { VoyagerClient } from "./voyager.js";
import { config } from "./config.js";

export interface ToolContext {
  voyager: VoyagerClient;
  tavilyKey?: string;
  symbol: string;
  country: string;
  source: string;
  shareName: string;
  webSources?: string[];
}

const MAX_PDF_CHARS = 30000;
const MAX_ANNOUNCEMENTS = 50;

function truncate(text: string, max = MAX_PDF_CHARS): string {
  return text.length > max ? text.slice(0, max) + "\n...[truncated]" : text;
}

async function fetchPdfText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`read_pdf status ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buf);
  return truncate(data.text || "");
}

function announcementFilter(
  announcements: { heading?: string; date?: string; category?: string; attachment?: string }[],
  keywords: string[],
  limit = 20,
) {
  const kw = keywords.map((k) => k.toLowerCase());
  return announcements
    .filter((a) => {
      const heading = (a.heading || "").toLowerCase();
      const category = (a.category || "").toLowerCase();
      return kw.some((k) => heading.includes(k) || category.includes(k));
    })
    .slice(0, limit);
}

export function buildTools(ctx: ToolContext) {
  const { voyager, symbol, country, source, shareName } = ctx;

  const cs = { country, source };

  return {
    get_financial_metrics: tool({
      description:
        "Fetch a single-period financial metrics snapshot (ratios, margins, growth, valuation, per-share figures) for a company. Use filing_type=ttm for trailing-twelve-months figures, quarterly/annual for point-in-time statements. Note: if the response has price_data=\"unavailable\", price-derived fields (current_price, market cap, PE/PB/PS, EV, technicals) are omitted and only filings-based ratios are present.",
      inputSchema: z.object({
        symbol: z.string().describe("Stock symbol, e.g. RELIANCE or NVDA."),
        country: z.enum(["in", "us"]).optional().describe("Defaults to the analyzed company's country."),
        source: z.enum(["nse", "sec"]).optional().describe("Defaults to the analyzed company's source."),
        consolidated: z.boolean().optional(),
        filing_type: z.enum(["ttm", "annual", "quarterly"]).optional(),
      }),
      execute: async (args) => {
        const data = await voyager.get("/financial-metrics", {
          symbol: args.symbol || symbol,
          country: args.country || country,
          source: args.source || source,
          consolidated: args.consolidated ?? true,
          filing_type: args.filing_type || "ttm",
        });
        if (!data || Object.keys(data).length <= 3) {
          return { message: "No financial metrics available for this symbol.", data: {} };
        }
        return data;
      },
    }),

    get_financials: tool({
      description:
        "Fetch a company's financial statements (income statement, balance sheet, cash flow). Returns rows keyed by XBRL-style field names for each reporting period.",
      inputSchema: z.object({
        symbol: z.string().optional().describe("Defaults to the analyzed company."),
        country: z.enum(["in", "us"]).optional(),
        source: z.enum(["nse", "sec"]).optional(),
        consolidated: z.boolean().optional(),
        filing_type: z.enum(["annual", "quarterly"]).optional(),
        all_fields: z.boolean().optional(),
      }),
      execute: async (args) => {
        return voyager.get("/financials", {
          symbol: args.symbol || symbol,
          country: args.country || country,
          source: args.source || source,
          consolidated: args.consolidated ?? true,
          filing_type: args.filing_type || "annual",
          all_fields: args.all_fields ?? false,
        });
      },
    }),

    get_income_statements: tool({
      description: "Fetch income statement rows for a company across reporting periods.",
      inputSchema: z.object({
        symbol: z.string().optional(),
        country: z.enum(["in", "us"]).optional(),
        source: z.enum(["nse", "sec"]).optional(),
        consolidated: z.boolean().optional(),
        all_fields: z.boolean().optional(),
      }),
      execute: async (args) => {
        return voyager.get("/financials/income-statements", {
          symbol: args.symbol || symbol,
          country: args.country || country,
          source: args.source || source,
          consolidated: args.consolidated ?? true,
          all_fields: args.all_fields ?? false,
        });
      },
    }),

    get_balance_sheets: tool({
      description: "Fetch balance sheet rows for a company across reporting periods.",
      inputSchema: z.object({
        symbol: z.string().optional(),
        country: z.enum(["in", "us"]).optional(),
        source: z.enum(["nse", "sec"]).optional(),
        consolidated: z.boolean().optional(),
        all_fields: z.boolean().optional(),
      }),
      execute: async (args) => {
        return voyager.get("/financials/balance-sheets", {
          symbol: args.symbol || symbol,
          country: args.country || country,
          source: args.source || source,
          consolidated: args.consolidated ?? true,
          all_fields: args.all_fields ?? false,
        });
      },
    }),

    get_cash_flows: tool({
      description: "Fetch cash flow statement rows for a company across reporting periods.",
      inputSchema: z.object({
        symbol: z.string().optional(),
        country: z.enum(["in", "us"]).optional(),
        source: z.enum(["nse", "sec"]).optional(),
        consolidated: z.boolean().optional(),
        all_fields: z.boolean().optional(),
      }),
      execute: async (args) => {
        return voyager.get("/financials/cash-flows", {
          symbol: args.symbol || symbol,
          country: args.country || country,
          source: args.source || source,
          consolidated: args.consolidated ?? true,
          all_fields: args.all_fields ?? false,
        });
      },
    }),

    get_announcements: tool({
      description:
        "Fetch recent exchange announcements for a company (earnings calls, board meetings, dividends, investor meets).",
      inputSchema: z.object({
        symbol: z.string().optional(),
        country: z.enum(["in", "us"]).optional(),
        source: z.enum(["nse", "sec"]).optional(),
        market: z.string().optional(),
      }),
      execute: async (args) => {
        const data = await voyager.get("/announcements", {
          symbol: args.symbol || symbol,
          country: args.country || country,
          source: args.source || source,
          market: args.market,
        });
        const announcements = data?.announcements || [];
        return {
          symbol: data?.symbol || symbol,
          count: announcements.length,
          announcements: announcements.slice(0, MAX_ANNOUNCEMENTS).map((a: any) => ({
            date: a.date,
            heading: a.heading,
            category: a.category,
            attachment: a.attachment,
            attachment_size: a.attachment_size,
          })),
        };
      },
    }),

    get_shareholdings: tool({
      description:
        "Fetch the latest shareholding pattern for a company (promoter, institutional, foreign institutional, and public ownership percentages).",
      inputSchema: z.object({
        symbol: z.string().optional(),
        country: z.enum(["in", "us"]).optional(),
        source: z.enum(["nse", "sec"]).optional(),
      }),
      execute: async (args) => {
        const data = await voyager.get("/shareholdings", {
          symbol: args.symbol || symbol,
          country: args.country || country,
          source: args.source || source,
        });
        return data?.shareholdings || { message: "No shareholding data available." };
      },
    }),

    list_categories: tool({
      description: "List available market categories: sources, countries, industries, sectors, indices.",
      inputSchema: z.object({
        category: z.string(),
        country: z.string().optional(),
        source: z.string().optional(),
      }),
      execute: async (args) => {
        return voyager.get("/list", {
          category: args.category,
          country: args.country || country,
          source: args.source || source,
        });
      },
    }),

    search_company_documents: tool({
      description:
        "Search a company's filings and announcements by keyword (e.g. 'dividend', 'buyback', 'transcript', 'audit'). Returns matching announcements with dates, categories, and attachment URLs.",
      inputSchema: z.object({
        keyword: z.string(),
        symbol: z.string().optional(),
        country: z.enum(["in", "us"]).optional(),
        source: z.enum(["nse", "sec"]).optional(),
      }),
      execute: async (args) => {
        const data = await voyager.get("/announcements", {
          symbol: args.symbol || symbol,
          country: args.country || country,
          source: args.source || source,
        });
        const announcements = (data?.announcements || []) as any[];
        const matched = announcementFilter(announcements, [args.keyword]);
        return {
          keyword: args.keyword,
          count: matched.length,
          matches: matched.map((a) => ({
            date: a.date,
            heading: a.heading,
            category: a.category,
            attachment: a.attachment,
          })),
        };
      },
    }),

    read_latest_transcript: tool({
      description:
        "Find and read the text of the company's most recent earnings call transcript / investors meet PDF.",
      inputSchema: z.object({
        symbol: z.string().optional(),
        country: z.enum(["in", "us"]).optional(),
        source: z.enum(["nse", "sec"]).optional(),
      }),
      execute: async (args) => {
        const data = await voyager.get("/announcements", {
          symbol: args.symbol || symbol,
          country: args.country || country,
          source: args.source || source,
        });
        const announcements = (data?.announcements || []) as any[];
        const matched = announcementFilter(
          announcements,
          ["transcript", "conference call", "analysts meet"],
          5,
        );
        if (matched.length === 0) {
          return { message: "No transcript found in recent announcements." };
        }
        const pdfs = matched.filter((a) => a.attachment);
        if (pdfs.length === 0) {
          return { matched: matched.map((a) => ({ date: a.date, heading: a.heading })) };
        }
        try {
          const text = await fetchPdfText(pdfs[0].attachment!);
          return {
            transcript_of: pdfs[0].heading,
            date: pdfs[0].date,
            url: pdfs[0].attachment!,
            text,
          };
        } catch (e: any) {
          return {
            message: "Could not parse transcript PDF.",
            url: pdfs[0].attachment!,
            error: e.message,
          };
        }
      },
    }),

    read_latest_presentation: tool({
      description:
        "Find and read the text of the company's most recent investor presentation / results presentation PDF.",
      inputSchema: z.object({
        symbol: z.string().optional(),
        country: z.enum(["in", "us"]).optional(),
        source: z.enum(["nse", "sec"]).optional(),
      }),
      execute: async (args) => {
        const data = await voyager.get("/announcements", {
          symbol: args.symbol || symbol,
          country: args.country || country,
          source: args.source || source,
        });
        const announcements = (data?.announcements || []) as any[];
        const matched = announcementFilter(
          announcements,
          ["presentation", "investor presentation", "earnings presentation"],
          5,
        );
        if (matched.length === 0) {
          return { message: "No investor presentation found in recent announcements." };
        }
        const pdfs = matched.filter((a) => a.attachment);
        if (pdfs.length === 0) {
          return { matched: matched.map((a) => ({ date: a.date, heading: a.heading })) };
        }
        try {
          const text = await fetchPdfText(pdfs[0].attachment!);
          return {
            presentation_of: pdfs[0].heading,
            date: pdfs[0].date,
            url: pdfs[0].attachment!,
            text,
          };
        } catch (e: any) {
          return {
            message: "Could not parse presentation PDF.",
            url: pdfs[0].attachment!,
            error: e.message,
          };
        }
      },
    }),

    read_pdf: tool({
      description:
        "Download and extract the text from any attachment/PDF URL (announcement attachments, filings, reports).",
      inputSchema: z.object({
        url: z.string(),
      }),
      execute: async (args) => {
        try {
          const text = await fetchPdfText(args.url);
          return { url: args.url, text };
        } catch (e: any) {
          return { url: args.url, error: e.message, message: "Could not read PDF." };
        }
      },
    }),

    web_search: tool({
      description:
        "Search the live web for recent news, analyst commentary, or context about the company. Requires the Tavily API key to be configured in Settings.",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async (args) => {
        if (!ctx.tavilyKey) {
          return {
            message:
              "Web search is not available: no Tavily API key configured. Rely on the other data tools.",
          };
        }
        const res = await fetch(config.tavilyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: ctx.tavilyKey,
            query: `${args.query} ${shareName || symbol}`,
            max_results: 5,
            ...(ctx.webSources?.length ? { include_domains: ctx.webSources } : {}),
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          return { message: `Web search failed with status ${res.status}.` };
        }
        const data = await res.json();
        const results = (data.results || []).map((r: any) => ({
          title: r.title,
          url: r.url,
          content: r.content ? truncate(r.content, 2000) : undefined,
        }));
        return { query: args.query, count: results.length, results };
      },
    }),
  };
}

export type Tools = ReturnType<typeof buildTools>;

export function extractToolCalls(steps: any[]): Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = [];
  for (const step of steps || []) {
    const byId = new Map<string, any>();
    for (const tc of step?.toolCalls || []) {
      byId.set(tc.toolCallId, {
        tool_name: tc.toolName,
        args: tc.input ?? {},
        status: "OK",
        duration: undefined,
        error: undefined,
      });
    }
    for (const tr of step?.toolResults || []) {
      const rec = byId.get(tr.toolCallId) || { tool_name: tr.toolName };
      rec.result = tr.output;
      byId.set(tr.toolCallId, rec);
    }
    for (const part of step?.content || []) {
      if (part?.type === "tool-error") {
        const rec = byId.get(part.toolCallId) || { tool_name: part.toolName };
        rec.status = "ERR";
        rec.error = String(part.error ?? "");
        byId.set(part.toolCallId, rec);
      }
    }
    for (const rec of byId.values()) {
      calls.push(rec);
    }
  }
  return calls;
}
