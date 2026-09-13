import { circuitBreaker, ConsecutiveBreaker, handleAll } from "cockatiel";

export const voyagerCircuitBreaker = circuitBreaker(handleAll, {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker(5),
});

// Voyager runs on Render's free tier, which cold-sleeps: the first call after
// idle can drop with 000/timeout/503. Retries are mandatory, not optional.
// 30s per attempt: short timeouts converge faster on a booting instance (each
// retry rides the boot that the previous abort already kicked off).
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 700;

// HTTP statuses worth retrying after (transient upstream unavailability).
// Voyager surfaces 503 for: rate-limit reached on pulls, unreachable price
// feed, temp DB issues, and free-tier cold starts.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Error raised when Voyager responds with a non-2xx status. */
export class VoyagerError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "VoyagerError";
    this.status = status;
    this.detail = detail;
  }
}

// Shape of GET /pull — the pull status / data availability endpoint.
// Verified against the live API + source (src/services/nse.py, sec.py):
// it returns `last_pull`, `total_records`, `record_counts`, etc. NOT
// `collections`/`last_pulled` (old clients read fields that never existed,
// which made every stock look empty and re-triggered pulls endlessly).
export interface PullStatus {
  symbol?: string;
  source?: string;
  available?: boolean;
  last_pull?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  total_pulls?: number;
  total_records?: number;
  previous_pulls_count?: number;
  /** Record count per collection, e.g. {"income_statements": 11, ...}. */
  record_counts?: Record<string, number>;
  /** Period coverage per statement, e.g. consolidated vs standalone ranges. */
  financial_breakdown?: Record<string, unknown>;
  // Legacy/stored shapes (analysis_runs.data_availability rows written by old
  // clients) — kept so assessDataAdequacy doesn't choke on historical data.
  collections?: Record<string, { records?: number }>;
  last_pulled?: string | null;
}

export interface PullJobStatus {
  job_id?: string;
  symbol?: string;
  source?: string;
  task?: string | null;
  status?: string;
  result?: Record<string, any> | null;
  error?: string | null;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

/** Total stored records for a symbol, tolerant of legacy shapes. */
export function pullRecordCount(status: PullStatus | null | undefined): number {
  if (!status) return 0;
  if (typeof status.total_records === "number" && Number.isFinite(status.total_records)) {
    return status.total_records;
  }
  const counts = Object.values(status.record_counts ?? {});
  if (counts.length > 0) return counts.reduce((n, c) => n + (c ?? 0), 0);
  // Legacy `collections` rows persisted by older clients.
  return Object.values(status.collections ?? {}).reduce((n, c) => n + (c?.records || 0), 0);
}

/** Most recent pull time for a symbol, tolerant of legacy shapes. */
export function pullLastPulled(status: PullStatus | null | undefined): string | null | undefined {
  if (!status) return undefined;
  return status.last_pull ?? status.last_pulled;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class VoyagerClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly minIntervalMs: number;
  private lastCallAt = 0;

  constructor(baseUrl: string, apiKey?: string, rpm = 60) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey || undefined;
    this.minIntervalMs = rpm > 0 ? Math.max(0, Math.ceil(60_000 / rpm)) : 0;
  }

  private throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return Promise.resolve();
    const wait = this.lastCallAt + this.minIntervalMs - Date.now();
    if (wait <= 0) return Promise.resolve();
    return sleep(wait);
  }

  private url(path: string, params: Record<string, unknown> = {}): URL {
    const u = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
    return u;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    return h;
  }

  async get(path: string, params: Record<string, unknown> = {}): Promise<any> {
    return this.request(path, params, "GET");
  }

  async post(path: string, params: Record<string, unknown> = {}, body?: unknown): Promise<any> {
    return this.request(path, params, "POST", body);
  }

  private request(
    path: string,
    params: Record<string, unknown>,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<any> {
    return voyagerCircuitBreaker.execute(() => this.requestDirect(path, params, method, body, 0));
  }

  private async requestDirect(
    path: string,
    params: Record<string, unknown>,
    method: "GET" | "POST",
    body?: unknown,
    attempt = 0,
  ): Promise<any> {
    await this.throttle();
    this.lastCallAt = Date.now();

    const headers = {
      ...this.headers(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    };

    let res: Response;
    try {
      res = await fetch(this.url(path, params), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (e: any) {
      // Network drop, DNS failure, or timeout from a cold-sleeping container.
      return this.retry(path, params, method, body, attempt, 0, `network error: ${e.message}`);
    }

    if (!res.ok) {
      const text = await res.text();
      let detail: unknown = undefined;
      try {
        detail = JSON.parse(text);
      } catch {
        detail = text;
      }
      const message =
        detail && typeof detail === "object" && typeof (detail as any).detail === "string"
          ? (detail as any).detail
          : text.slice(0, 500);

      if (RETRYABLE_STATUSES.has(res.status)) {
        // Respect Retry-After when the server asks, else back off exponentially.
        const retryAfter = Number(res.headers.get("retry-after") || 0);
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : BASE_DELAY_MS * 2 ** attempt;
        return this.retry(path, params, method, body, attempt, res.status, message, delay);
      }

      throw new VoyagerError(res.status, message, detail);
    }

    try {
      return await res.json();
    } catch {
      return { detail: await res.text() };
    }
  }

  private async retry(
    path: string,
    params: Record<string, unknown>,
    method: "GET" | "POST",
    body: unknown | undefined,
    attempt: number,
    status: number,
    message: string,
    delayOverrideMs?: number,
  ): Promise<any> {
    if (attempt < MAX_RETRIES) {
      // 409 on POST is NOT retried here: it means a job for this key is already
      // running. Callers (freshness.ts) adopt the existing job instead.
      const delay = delayOverrideMs ?? BASE_DELAY_MS * 2 ** attempt;
      await sleep(delay);
      return this.requestDirect(path, params, method, body, attempt + 1);
    }
    throw new VoyagerError(status, `${method} ${path} ${message} (after ${MAX_RETRIES + 1} attempts)`);
  }

  // ── Pull status & jobs ──────────────────────────────────────────────

  async getPullStatus(symbol: string, _country: string, source: string): Promise<PullStatus> {
    // GET /pull accepts symbol + source only; country is derived server-side.
    const data = await this.get("/pull", { symbol, source });
    return (data ?? {}) as PullStatus;
  }

  async triggerPull(
    symbol: string,
    _country: string,
    source: string,
    filingType = "quarterly",
    refresh = false,
  ): Promise<{ job_id: string; status: string; status_url: string }> {
    return this.post("/pull", { symbol, source, filing_type: filingType, refresh });
  }

  async getPullJobStatus(jobId: string): Promise<PullJobStatus> {
    return this.get(`/pull/jobs/${jobId}`);
  }

  async listPullJobs(limit = 20): Promise<PullJobStatus[]> {
    return this.get("/pull/jobs", { limit });
  }

  // ── DCF valuation ───────────────────────────────────────────────────

  async getDcfValuation(
    symbol: string,
    source: string,
    params: {
      growth_rate?: number;
      terminal_growth_rate?: number;
      discount_rate?: number;
      years?: number;
      beta?: number;
    } = {},
  ): Promise<any> {
    return this.get("/dcf", { symbol, source, ...params });
  }

  // ── News (these accept an explicit country param) ───────────────────

  async getMarketNews(params: {
    country?: string;
    days?: number;
    limit?: number;
  } = {}): Promise<any> {
    return this.get("/news/stories", params);
  }

  async getTickerNews(
    symbol: string,
    params: {
      country?: string;
      days?: number;
      limit?: number;
    } = {},
  ): Promise<any> {
    return this.get("/news/ticker", { symbol, ...params });
  }

  // ── Social ──────────────────────────────────────────────────────────

  async searchReddit(query: string, limit = 10): Promise<any> {
    return this.get("/social/reddit", { query, limit });
  }

  async searchYouTube(query: string, limit = 15): Promise<any> {
    return this.get("/social/youtube/search", { query, limit });
  }

  async getYouTubeTranscript(videoId: string): Promise<any> {
    return this.get("/social/youtube/transcript", { video_id: videoId });
  }

  // ── Documents ───────────────────────────────────────────────────────

  async parseDocument(url: string, symbol?: string, source?: string): Promise<any> {
    return this.post("/documents/parse", { url, symbol, source });
  }

  async getDocumentIndex(documentId: number): Promise<any> {
    return this.get(`/documents/${documentId}/index`);
  }

  // ── Sentiment ───────────────────────────────────────────────────────

  async analyzeManagementSentiment(params: {
    url?: string;
    text?: string;
    symbol?: string;
    source?: string;
    model?: string;
  }): Promise<any> {
    return this.post("/sentiment/management", params);
  }
}

export function toCountrySource(source: string): { country: string; source: string } {
  if (source === "SEC") return { country: "us", source: "sec" };
  if (source === "NSE") return { country: "in", source: "nse" };
  return { country: "in", source: source.toLowerCase() };
}