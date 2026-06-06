import axios from "axios";

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
        // Nebula ProfileModel expects '_id'
        const data = {
            ...profile,
            _id: profile._id || profile.id
        };
        console.log(data)
        const response = await axios.post(`${NEBULA_BASE}/update-profile`, data);
        return response.data;
    },

    async deleteProfile(id: string) {
        // Nebula expects a ProfileModel object with '_id'
        const response = await axios.post(`${NEBULA_BASE}/delete-profile`, { _id: id });
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

    async runAnalysis(config: { share_name: string; symbol: string; profile_name: string }) {
        // Nebula endpoint is /run-analysis, not /correlate
        const response = await axios.post(`${NEBULA_BASE}/run-analysis`, config);
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

export const VoyagerService = {
    async getSources() {
        const response = await axios.get(`${VOYAGER_BASE}/sources`);
        return response.data.sources || [];
    },

    async getSchema(source: string) {
        const response = await axios.get(`${VOYAGER_BASE}/schema/${source}`);
        return response.data;
    }
};
