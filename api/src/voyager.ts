const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

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

export interface CollectionStatus {
  records?: number;
  last_pulled?: string | null;
}

export interface PullStatus {
  symbol?: string;
  available?: boolean;
  collections?: Record<string, CollectionStatus>;
  last_pulled?: string | null;
  history?: unknown[];
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

  // Space out requests so we don't trip the per-key rpm limit.
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

  private async request(
    path: string,
    params: Record<string, unknown>,
    method: "GET" | "POST",
    body?: unknown,
    attempt = 0,
  ): Promise<any> {
    await this.throttle();
    this.lastCallAt = Date.now();

    const url = this.url(path, params);
    const headers = {
      ...this.headers(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (e: any) {
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        return this.request(path, params, method, body, attempt + 1);
      }
      throw new VoyagerError(0, `${method} ${path} network error: ${e.message}`);
    }

    const text = await res.text();
    if (!res.ok) {
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

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after") || 0);
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : BASE_DELAY_MS * 2 ** attempt;
        await sleep(delay);
        return this.request(path, params, method, body, attempt + 1);
      }

      throw new VoyagerError(res.status, message, detail);
    }

    try {
      return JSON.parse(text);
    } catch {
      return { detail: text };
    }
  }

  // Read-only pull status / data availability for a stock. Never submits a pull.
  async getPullStatus(symbol: string, country: string, source: string): Promise<PullStatus> {
    const data = await this.get("/pull", { symbol, country, source });
    return (data ?? {}) as PullStatus;
  }

  // Trigger an async data pull. Returns a job_id for polling.
  async triggerPull(
    symbol: string,
    country: string,
    source: string,
    filingType = "quarterly",
    refresh = false,
  ): Promise<{ job_id: string; status: string; status_url: string }> {
    return this.post("/pull", { symbol, country, source, filing_type: filingType, refresh });
  }

  // Check the status of an async pull job.
  async getPullJobStatus(
    jobId: string,
  ): Promise<{ job_id: string; status: string; error?: string; duration_ms?: number }> {
    return this.get(`/pull/jobs/${jobId}`);
  }
}

export function toCountrySource(source: string): { country: string; source: string } {
  if (source === "SEC") return { country: "us", source: "sec" };
  if (source === "NSE") return { country: "in", source: "nse" };
  return { country: "in", source: source.toLowerCase() };
}
