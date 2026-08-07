const DEFAULT_TIMEOUT_MS = 120_000;

export class VoyagerClient {
  constructor(private readonly baseUrl: string) {}

  private url(path: string, params: Record<string, unknown> = {}): URL {
    const u = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
    return u;
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
  ): Promise<any> {
    const url = this.url(path, params);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${method} ${path} status ${res.status}: ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { detail: text };
    }
  }
}

export function toCountrySource(source: string): { country: string; source: string } {
  if (source === "SEC") return { country: "us", source: "sec" };
  if (source === "NSE") return { country: "in", source: "nse" };
  return { country: "in", source: source.toLowerCase() };
}

export async function ensureDataPulled(
  voyager: VoyagerClient,
  symbol: string,
  country: string,
  source: string,
): Promise<{ available: boolean; last_pull?: string }> {
  try {
    const status = await voyager.get("/pull", { symbol, country, source });
    if (status?.available) return status;
  } catch {
    // not pulled yet
  }
  try {
    await voyager.post("/pull", { symbol, country, source });
  } catch {
    // pull already running or failed; fall through to polling
  }
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15_000));
    try {
      const status = await voyager.get("/pull", { symbol, country, source });
      if (status?.available) return status;
    } catch {
      // still not available
    }
  }
  return { available: false };
}
