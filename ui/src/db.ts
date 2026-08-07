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
 * Global Agent Service - delegates to the backend API
 */
export const AgentService = {
    async listAgents() {
        const response = await axios.get(`${API_BASE}/agents`);
        return response.data;
    },

    async readAgent(id: string) {
        const response = await axios.get(`${API_BASE}/agents/${encodeURIComponent(id)}`);
        return response.data;
    },

    async createAgent(name?: string) {
        const response = await axios.post(`${API_BASE}/agents`, { name });
        return response.data;
    },

    async updateAgent(agent: any) {
        const id = agent?._id ?? agent?.id;
        if (!id) throw new Error("Agent id required for update");
        const response = await axios.put(`${API_BASE}/agents/${encodeURIComponent(id)}`, agent);
        return response.data;
    },

    async deleteAgent(id: string) {
        const response = await axios.delete(`${API_BASE}/agents/${encodeURIComponent(id)}`);
        return response.data;
    },

    async searchAgents(query: string) {
        const response = await axios.get(`${API_BASE}/agents/search`, {
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
        agent_name: string;
        model?: string;
        source?: string;
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
