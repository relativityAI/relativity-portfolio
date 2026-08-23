import axios from "axios";
import { supabase } from "@/lib/supabase";

export const API_BASE = import.meta.env.VITE_RELATIVITY_API || "/api";

// Only attach the Supabase auth token — keys are now stored server-side.
axios.interceptors.request.use(async (config) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) config.headers.Authorization = `Bearer ${token}`;
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
        const response = await axios.get(`${API_BASE}/metrics/fields?source=${encodeURIComponent(source)}`);
        return response.data;
    },

    async draftParameters(payload: { persona: string; section: string }): Promise<{ parameters: { parameter: string; content: string; weightage: number }[] }> {
        const response = await axios.post(`${API_BASE}/agents/draft-parameters`, payload);
        return response.data;
    }
};

export const DataService = {
    async getDataStatus(symbol: string, source: string) {
        const response = await axios.get(`${API_BASE}/analysis/data-status`, {
            params: { symbol, source }
        });
        return response.data;
    },

    async getVoyagerHealth() {
        const response = await axios.get(`${API_BASE}/health/voyager`);
        return response.data;
    }
};

export const SettingsService = {
    async getSettings() {
        const response = await axios.get(`${API_BASE}/user/settings`);
        return response.data as { voyager_key: string | null; llm_keys: Record<string, string> };
    },

    async updateSettings(payload: { voyager_key?: string; llm_keys?: Record<string, string> }) {
        const response = await axios.put(`${API_BASE}/user/settings`, payload);
        return response.data;
    },

    async deleteLLMKey(keyName: string) {
        const response = await axios.delete(`${API_BASE}/user/settings/llm-key/${encodeURIComponent(keyName)}`);
        return response.data;
    }
};
