import axios from "axios";

axios.interceptors.request.use((config) => {
    const openaiKey = localStorage.getItem("openai_key");
    const geminiKey = localStorage.getItem("gemini_key");
    const cerebrasKey = localStorage.getItem("cerebras_key");

    if (openaiKey) config.headers["X-LLM-OpenAI-Key"] = openaiKey;
    if (geminiKey) config.headers["X-LLM-Gemini-Key"] = geminiKey;
    if (cerebrasKey) config.headers["X-LLM-Cerebras-Key"] = cerebrasKey;

    const tavilyKey = localStorage.getItem("tavily_key");
    if (tavilyKey) config.headers["X-LLM-Tavily-Key"] = tavilyKey;

    return config;
});

// Directly targeting services via Vite proxy to bypass CORS
const VOYAGER_BASE = "/voyager-api";
export const NEBULA_BASE = "/nebula-api";
const RELATIVITY_BASE = "/api";

/**
 * Global Profile Service - delegates to the backend API
 */
export const ProfileService = {
    async listProfiles() {
        const response = await axios.get(`${NEBULA_BASE}/list-profiles`);
        return response.data;
    },

    async readProfile(id: string) {
        const response = await axios.get(`${NEBULA_BASE}/read-profile`, {
            params: { id }
        });
        return response.data;
    },

    async createProfile(name?: string) {
        const response = await axios.get(`${NEBULA_BASE}/create-profile`, {
            params: { name }
        });
        return response.data;
    },

    async updateProfile(profile: any) {
        const response = await axios.post(`${NEBULA_BASE}/update-profile`, profile);
        return response.data;
    },

    async deleteProfile(id: string) {
        const response = await axios.post(`${NEBULA_BASE}/delete-profile`, { _id: id });
        return response.data;
    },

    async searchProfiles(query: string) {
        const response = await axios.get(`${NEBULA_BASE}/search-profiles`, {
            params: { query }
        });
        return response.data;
    }
};

export const AnalysisService = {
    async listAnalyses() {
        const response = await axios.get(`${NEBULA_BASE}/list-analysis`);
        return response.data;
    },

    async readAnalysis(id: string) {
        const response = await axios.get(`${NEBULA_BASE}/read-analysis`, {
            params: { id }
        });
        return response.data;
    },

    /**
     * Note: Nebula doesn't have a standalone create-analysis endpoint.
     * Creation is handled by run-analysis.
     */
    async createAnalysis() {
        return { id: null };
    },

    async deleteAnalysis(id: string) {
        // Nebula expects POST /delete-analysis with { analysis_id: id }
        const response = await axios.post(`${NEBULA_BASE}/delete-analysis`, {
            analysis_id: id
        });
        return response.data;
    },

    async runAnalysis(config: {
        share_name: string;
        symbol: string;
        profile_name: string;
        model?: string;
        documents?: string[];
        web_search?: boolean;
        web_sources?: string[];
    }) {
        const response = await axios.post(`${NEBULA_BASE}/run-analysis`, config);
        return response.data;
    },

    async getAvailableSources() {
        const response = await axios.get(`${NEBULA_BASE}/available-sources`);
        return response.data;
    },

    async getAvailableModels() {
        const response = await axios.get(`${NEBULA_BASE}/available-models`);
        return response.data;
    }
};

export const SearchService = {
    async searchExchanges(query: string) {
        const response = await axios.get(`${RELATIVITY_BASE}/search-exchanges`, {
            params: { query }
        });
        return response.data;
    },

    async searchShares(query: string) {
        const response = await axios.get(`${RELATIVITY_BASE}/search-shares`, {
            params: { query }
        });
        return response.data;
    }
};

function toCountrySource(profileSource: string): { country: string; source: string } {
    if (profileSource === "SEC") return { country: "us", source: "sec" }
    if (profileSource === "NSE") return { country: "in", source: "nse" }
    return { country: "in", source: profileSource.toLowerCase() }
}

export const VoyagerService = {
    async getSources() {
        const response = await axios.get(`${VOYAGER_BASE}/equity/sources`);
        return response.data.sources || [];
    },

    async getSchema(source: string) {
        const response = await axios.get(`${VOYAGER_BASE}/equity/schema/${source}`);
        return response.data;
    },

    async getLastDataPull(symbol: string, source: string) {
        try {
            const cs = toCountrySource(source)
            const response = await axios.get(`${VOYAGER_BASE}/equity/data/status`, {
                params: { symbol, ...cs }
            });
            const d = response.data;
            return { last_pull: d.last_pull || d.lastPulledAt || null };
        } catch {
            return { last_pull: null };
        }
    },

    async pullLatestData(symbol: string, source: string) {
        try {
            const cs = toCountrySource(source)
            const response = await axios.post(`${VOYAGER_BASE}/equity/data/pull`, null, {
                params: { symbol, ...cs }
            });
            return response.data;
        } catch {
            return { status: "initiated" };
        }
    },

    async checkDataStatus(symbol: string, source: string) {
        try {
            const cs = toCountrySource(source)
            const response = await axios.get(`${VOYAGER_BASE}/equity/data/status`, {
                params: { symbol, ...cs }
            });
            return { ...response.data, symbol, source, status: "ok" };
        } catch {
            return { symbol, source, status: "unknown" };
        }
    },

    async getStockData(symbol: string, source: string, collections?: string[], metrics?: string[], limit?: number) {
        const cs = toCountrySource(source)
        const params: Record<string, any> = { symbol, ...cs }
        if (collections?.length) params.collections = collections
        if (metrics?.length) params.metrics = metrics
        if (limit && limit > 0) params.limit = limit
        const response = await axios.get(`${VOYAGER_BASE}/equity/data/metrics`, { params });
        return response.data;
    },

    async getStockDataStatus(symbol: string, source: string) {
        try {
            const cs = toCountrySource(source)
            const response = await axios.get(`${VOYAGER_BASE}/equity/data/status`, {
                params: { symbol, ...cs }
            });
            return response.data;
        } catch (error: any) {
            if (error?.response?.data) return error.response.data;
            return null;
        }
    },

    async pullStockData(symbol: string, source: string) {
        try {
            const cs = toCountrySource(source)
            const response = await axios.post(`${VOYAGER_BASE}/equity/data/pull`, null, {
                params: { symbol, ...cs }
            });
            return response.data;
        } catch {
            return { status: "initiated" };
        }
    },

    async getFinancialRatios(symbol: string, source: string, consolidated = "Consolidated") {
        try {
            const cs = toCountrySource(source)
            const response = await axios.get(`${VOYAGER_BASE}/equity/data/ratios`, {
                params: { symbol, ...cs, consolidated }
            });
            return response.data;
        } catch (error: any) {
            if (error?.response?.data) return error.response.data;
            return null;
        }
    },

    async getAvailableWebSources() {
        try {
            const response = await axios.get(`${VOYAGER_BASE}/equity/web/sources`);
            return response.data;
        } catch {
            return { sources: [] };
        }
    },

    async getAvailableMetrics(source: string) {
        try {
            const cs = toCountrySource(source)
            const response = await axios.get(`${VOYAGER_BASE}/equity/data/metrics/available`, {
                params: cs
            });
            return response.data;
        } catch (error: any) {
            if (error?.response?.data) return error.response.data;
            return { categories: [] };
        }
    }
};
