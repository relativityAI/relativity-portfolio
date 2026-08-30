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
}

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

    try {
        const api = await axios.get(endpoints.api, { timeout: 3000 });
        data.api = api.status === 200 || api.data.ok ? 1 : 0;
        data.db = api.data?.db ? 1 : 0;
    } catch (error) {
        console.error(`Health check failed for api:`, error);
        data.api = 0;
        data.db = 0;
    }

    try {
        const voyager = await axios.get(endpoints.voyagerApi, { timeout: 5000 });
        data.voyagerApi = voyager.data?.ok ? 1 : 0;
        data.voyagerKeyed = !!voyager.data?.keyed;
    } catch (error) {
        console.error(`Health check failed for voyagerApi:`, error);
        data.voyagerApi = 0;
        data.voyagerKeyed = false;
    }

    return { data, endpoints };
}
