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

export function buildWebSearchTool(tavilyKey?: string, querySuffix?: string, webSources?: string[]) {
  return tool({
    description:
      "Search the live web for recent news, analyst commentary, or context. Requires the Tavily API key to be configured in Settings.",
    inputSchema: z.object({
      query: z.string(),
    }),
    execute: async (args) => {
      if (!tavilyKey) {
        return {
          message:
            "Web search is not available: no Tavily API key configured. Rely on the other data tools.",
        };
      }
      const res = await fetch(config.tavilyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: querySuffix ? `${args.query} ${querySuffix}` : args.query,
          max_results: 5,
          ...(webSources?.length ? { include_domains: webSources } : {}),
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
  });
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

    // ── Advanced Data Suite: valuation, news, social, documents, sentiment ──

    get_dcf_valuation: tool({
      description:
        "Run a two-stage discounted cash flow (DCF) valuation. Returns intrinsic value per share, margin of safety versus the current price, and every assumption used (stage-1 FCF growth rate, terminal growth, discount/WACC rate, years, beta, risk-free rate, market premium). Use for fair-value, upside, or margin-of-safety checks. For NSE companies pass source=nse; for US companies source=sec.",
      inputSchema: z.object({
        symbol: z.string().describe("Stock symbol, e.g. RELIANCE or AMZN."),
        source: z.enum(["nse", "sec"]).optional().describe("Defaults to the analyzed company's source."),
        growth_rate: z.number().min(0).max(0.5).describe("Stage-1 FCF growth rate as a decimal (0.15 = 15%). Defaults to revenue growth.").optional(),
        terminal_growth_rate: z.number().min(0).max(0.1).describe("Terminal growth rate as a decimal (default 0.04).").optional(),
        discount_rate: z.number().min(0).max(0.5).describe("WACC/discount rate as a decimal. Defaults to CAPM cost of equity.").optional(),
        years: z.number().int().min(1).max(20).describe("Stage-1 projection years (default 5).").optional(),
        beta: z.number().describe("Beta used for the CAPM discount rate (default 1.0).").optional(),
      }),
      execute: async (args) => {
        const data = await voyager.getDcfValuation(args.symbol || symbol, args.source || source, {
          growth_rate: args.growth_rate,
          terminal_growth_rate: args.terminal_growth_rate,
          discount_rate: args.discount_rate,
          years: args.years,
          beta: args.beta,
        });
        if (data && data.detail && data.detail.includes("No free cash flow")) {
          return { message: data.detail };
        }
        return data;
      },
    }),

    get_market_news: tool({
      description:
        "Fetch the latest market news stories via RSS for a country ('in' or 'us'), with title, source, URL, summary, and publish time. Use for macro context, market direction, sector news, and sentiment.",
      inputSchema: z.object({
        country: z.enum(["in", "us"]).optional().describe("Market: us or in."),
        days: z.number().int().min(1).max(30).describe("Look-back window in days (default 7).").optional(),
        limit: z.number().int().min(1).max(50).describe("Number of stories (default 20).").optional(),
      }),
      execute: async (args) => {
        return voyager.getMarketNews({
          country: args.country || country,
          days: args.days,
          limit: args.limit,
        });
      },
    }),

    get_ticker_news: tool({
      description:
        "Fetch news stories that explicitly mention a stock symbol. Use to understand recent company-specific news flow, catalysts, and coverage. Can return zero stories if the ticker has no recent coverage.",
      inputSchema: z.object({
        symbol: z.string().describe("Stock symbol, e.g. RELIANCE or AMZN."),
        country: z.enum(["in", "us"]).optional().describe("Market: us or in. Defaults to the analyzed company's country."),
        days: z.number().int().min(1).max(30).describe("Look-back window in days (default 7).").optional(),
      }),
      execute: async (args) => {
        return voyager.getTickerNews(args.symbol || symbol, {
          country: args.country || country,
          days: args.days,
        });
      },
    }),

    search_reddit: tool({
      description:
        "Search Reddit for posts about a ticker or company. Returns post titles, subreddits, URLs, scores, and dates. Use for retail sentiment, community discussion, and crowd-sourced company research.",
      inputSchema: z.object({
        query: z.string().describe("Search query, e.g. 'KEI Industries' or 'AMZN earnings'."),
        limit: z.number().int().min(1).max(50).describe("Number of posts to return (default 10).").optional(),
      }),
      execute: async (args) => {
        return voyager.searchReddit(args.query, args.limit ?? 10);
      },
    }),

    search_youtube: tool({
      description:
        "Search YouTube for videos about a ticker or company — e.g. earnings calls, interviews, or analyst commentary. Returns video id, title, channel, view counts, publish date, duration, and URL.",
      inputSchema: z.object({
        query: z.string().describe("Search query, e.g. 'KEI Industries earnings call'."),
        limit: z.number().int().min(1).max(50).describe("Number of videos (default 15).").optional(),
      }),
      execute: async (args) => {
        return voyager.searchYouTube(args.query, args.limit ?? 15);
      },
    }),

    get_youtube_transcript: tool({
      description:
        "Fetch the transcript (captions) of a YouTube video by video ID (from search_youtube). Use to read the substance of an earnings call or interview without watching it. May fail for videos without captions or when YouTube blocks the request; if so, rely on the PDF transcript tools instead.",
      inputSchema: z.object({
        video_id: z.string().describe("YouTube video ID, e.g. 'JInWssm6M80'."),
      }),
      execute: async (args) => {
        const data = await voyager.getYouTubeTranscript(args.video_id);
        if (typeof data?.transcript === "string") {
          return { ...data, transcript: truncate(data.transcript) };
        }
        return data;
      },
    }),

    parse_pdf_document: tool({
      description:
        "Submit a PDF URL (announcement attachment, filing, transcript, or presentation) to be parsed into a structured page-by-page index. Async: returns a job_id. Poll get_pull_job_status with that job_id until it finishes, then call get_document_index with the document_id to retrieve the page tree.",
      inputSchema: z.object({
        url: z.string().describe("PDF URL or path to structure."),
        symbol: z.string().optional().describe("Stock symbol, defaults to the analyzed company."),
        source: z.enum(["nse", "sec"]).optional().describe("Defaults to the analyzed company's source."),
      }),
      execute: async (args) => {
        return voyager.parseDocument(args.url, args.symbol || symbol, args.source || source);
      },
    }),

    get_document_index: tool({
      description:
        "Fetch the cached page-index tree for a document that was parsed via parse_pdf_document. Navigate the document structurally — pages, sections, and their text spans.",
      inputSchema: z.object({
        document_id: z.number().int().describe("Document ID returned by parse_pdf_document or get_pull_job_status."),
      }),
      execute: async (args) => {
        return voyager.getDocumentIndex(args.document_id);
      },
    }),

    analyze_management_sentiment: tool({
      description:
        "Submit a transcript URL or raw text of management commentary (earnings call, interview, letter) to be analyzed for facts, guidance, and tone. Async: returns a job_id. Poll get_pull_job_status with that job_id to retrieve the analysis when the job is done. Supply one of 'url' or 'text'.",
      inputSchema: z.object({
        url: z.string().describe("PDF/transcript URL to analyze. Provide this or 'text', not both.").optional(),
        text: z.string().describe("Raw management commentary text to analyze. Provide this or 'url', not both.").optional(),
        symbol: z.string().optional().describe("Stock symbol, defaults to the analyzed company."),
        source: z.enum(["nse", "sec"]).optional().describe("Defaults to the analyzed company's source."),
        model: z.string().optional().describe("Optional LLM model override."),
      }),
      execute: async (args) => {
        if (!args.url && !args.text) {
          return { message: "Provide either 'url' or 'text' for management sentiment analysis." };
        }
        return voyager.analyzeManagementSentiment({
          url: args.url,
          text: args.text,
          symbol: args.symbol || symbol,
          source: args.source || source,
          model: args.model,
        });
      },
    }),

    // ── Data availability & pulls ──

    get_pull_status: tool({
      description:
        "Check what data exists for a stock in the database: record counts and period ranges by collection (income statements, balance sheets, cash flows, shareholdings), last pull time, and whether data is available. Use to determine if a symbol has adequate coverage before analyzing it.",
      inputSchema: z.object({
        symbol: z.string().describe("Stock symbol, e.g. RELIANCE or AMZN."),
        source: z.enum(["nse", "sec"]).optional().describe("Defaults to the analyzed company's source."),
      }),
      execute: async (args) => {
        const s = args.source || source;
        const c = s === "sec" ? "us" : "in";
        return voyager.getPullStatus(args.symbol || symbol, c, s);
      },
    }),

    trigger_data_pull: tool({
      description:
        "Trigger an async job to pull raw stock data (XBRL filings) from the exchange into the database. Use when get_pull_status shows a stock has no data. Returns a job_id — poll get_pull_job_status until it is 'done'. Do not call for symbols that already have data.",
      inputSchema: z.object({
        symbol: z.string().describe("Stock symbol to pull, e.g. RELIANCE or AMZN."),
        source: z.enum(["nse", "sec"]).optional().describe("Defaults to the analyzed company's source."),
        filing_type: z.enum(["quarterly", "annual"]).describe("Which filings to pull (default quarterly).").optional(),
        refresh: z.boolean().describe("Re-download and re-parse filings already in the DB (default false).").optional(),
      }),
      execute: async (args) => {
        const s = args.source || source;
        const c = s === "sec" ? "us" : "in";
        return voyager.triggerPull(args.symbol || symbol, c, s, args.filing_type || "quarterly", args.refresh ?? false);
      },
    }),

    get_pull_job_status: tool({
      description:
        "Check the status of any async Voyager job by job_id: data pulls (trigger_data_pull), document parsing (parse_pdf_document), and management sentiment analysis (analyze_management_sentiment). While status is 'running' or 'queued', wait and poll again. When 'done', the 'result' field holds the output.",
      inputSchema: z.object({
        job_id: z.string().describe("Job ID returned by trigger_data_pull, parse_pdf_document, or analyze_management_sentiment."),
      }),
      execute: async (args) => {
        return voyager.getPullJobStatus(args.job_id);
      },
    }),

    list_pull_jobs: tool({
      description:
        "List recent async Voyager jobs (data pulls, document parses, sentiment analyses) with their status and results.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).describe("Number of jobs (default 20).").optional(),
      }),
      execute: async (args) => {
        return voyager.listPullJobs(args.limit ?? 20);
      },
    }),

    web_search: buildWebSearchTool(ctx.tavilyKey, ctx.shareName || ctx.symbol, ctx.webSources),
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
