import axios from "axios";

// All data services go through the in-repo backend (Vite proxy /api -> :8080).
// The backend reads LLM keys and the Voyager URL from these headers, keeping
// secrets in the browser only.
export const API_BASE = "/api";

const LLM_KEY_HEADERS: Record<string, string> = {
    openai_key: "X-LLM-OpenAI-Key",
    gemini_key: "X-LLM-Gemini-Key",
    anthropic_key: "X-LLM-Anthropic-Key",
    cerebras_key: "X-LLM-Cerebras-Key",
    groq_key: "X-LLM-Groq-Key",
    tavily_key: "X-LLM-Tavily-Key",
};

axios.interceptors.request.use((config) => {
    for (const [storeKey, header] of Object.entries(LLM_KEY_HEADERS)) {
        const v = localStorage.getItem(storeKey);
        if (v) config.headers[header] = v;
    }

    const voyagerUrl = localStorage.getItem("voyager_url");
    if (voyagerUrl) config.headers["X-Voyager-URL"] = voyagerUrl;

    return config;
});

/**
 * Global Profile Service - delegates to the backend API
 */
export const ProfileService = {
    async listProfiles() {
        const response = await axios.get(`${API_BASE}/profiles`);
        return response.data;
    },

    async readProfile(id: string) {
        const response = await axios.get(`${API_BASE}/profiles/${encodeURIComponent(id)}`);
        return response.data;
    },

    async createProfile(name?: string) {
        const response = await axios.post(`${API_BASE}/profiles`, { name });
        return response.data;
    },

    async updateProfile(profile: any) {
        const id = profile?._id ?? profile?.id;
        if (!id) throw new Error("Profile id required for update");
        const response = await axios.put(`${API_BASE}/profiles/${encodeURIComponent(id)}`, profile);
        return response.data;
    },

    async deleteProfile(id: string) {
        const response = await axios.delete(`${API_BASE}/profiles/${encodeURIComponent(id)}`);
        return response.data;
    },

    async searchProfiles(query: string) {
        const response = await axios.get(`${API_BASE}/profiles/search`, {
            params: { query }
        });
        return response.data;
    }
};

export const AnalysisService = {
    async listAnalyses() {
        const response = await axios.get(`${API_BASE}/analysis`);
        return response.data;
    },

    async readAnalysis(id: string) {
        const response = await axios.get(`${API_BASE}/analysis/${encodeURIComponent(id)}`);
        return response.data;
    },

    async createAnalysis() {
        return { id: null };
    },

    async deleteAnalysis(id: string) {
        const response = await axios.delete(`${API_BASE}/analysis/${encodeURIComponent(id)}`);
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
        const response = await axios.post(`${API_BASE}/analysis`, config);
        return response.data;
    },

    async getAvailableSources() {
        const response = await axios.get(`${API_BASE}/sources`);
        return response.data;
    },

    async getAvailableModels() {
        const response = await axios.get(`${API_BASE}/models`);
        return response.data;
    }
};

export const VoyagerService = {
    async getAvailableMetrics(source: string) {
        const response = await axios.get(`${API_BASE}/metrics`, {
            params: { source }
        });
        return response.data;
    }
};
