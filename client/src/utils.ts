import axios from "axios";
import { API_BASE } from "./db";

export function formatSeconds(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
}

export function hasRequiredKeys(settings: { llm_keys?: Record<string, string> }): { hasLlm: boolean; hasTavily: boolean } {
    const keys = settings.llm_keys || {};
    const hasTavily = !!keys.tavily;
    const hasLlm = Object.entries(keys).some(([k, v]) => k !== "tavily" && !!v);
    return { hasLlm, hasTavily };
}

export function agentDisplayName(raw: string | undefined, agents: any[]): string {
    if (!raw) return "";
    const hit = agents.find((a) => a.name === raw || a._id === raw || a.id === raw);
    return hit?.name || raw;
}// Health checks run frequently (NavBar), so they must never stack latency:
// both probes fire in PARALLEL, the fast local probe uses a short timeout, and
// the Voyager probe (which can block on a cold-starting upstream) gets a
// bounded timeout instead of stalling the status bar for seconds.
export const runHealthCheck = async () => {
    const data = {
        api: 0,
        db: 0,
        voyagerApi: 0,
        voyagerKeyed: false,
    };

    const endpoints = {
        api: `${API_BASE}/health`,
        db: `${API_BASE}/health`,
        voyagerApi: `${API_BASE}/health/voyager`,
    };

    const [apiRes, voyagerRes] = await Promise.allSettled([
        axios.get(endpoints.api, { timeout: 3000 }),
        axios.get(endpoints.voyagerApi, { timeout: 6000 }),
    ]);

    if (apiRes.status === "fulfilled") {
        data.api = apiRes.value.status === 200 || apiRes.value.data?.ok ? 1 : 0;
        data.db = apiRes.value.data?.db ? 1 : 0;
    } else {
        console.error(`Health check failed for api:`, apiRes.reason);
    }

    if (voyagerRes.status === "fulfilled" && voyagerRes.value.data?.ok) {
        data.voyagerApi = 1;
        data.voyagerKeyed = !!voyagerRes.value.data?.keyed;
    } else {
        if (voyagerRes.status === "rejected") {
            console.warn(`Voyager probe failed (likely cold start):`, String(voyagerRes.reason));
        }
        // The probe answered but reported not-ok — keep keyed info if present.
        if (voyagerRes.status === "fulfilled" && voyagerRes.value.data) {
            data.voyagerKeyed = !!voyagerRes.value.data.keyed;
        }
    }

    return { data, endpoints };
}
