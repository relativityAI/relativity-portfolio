import axios from "axios";

export function formatSeconds(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
}

export const runHealthCheck = async () => {
    const data = {
        api: 0,
        db: 0,
        voyagerApi: 0,
    };

    let endpoints = {
        api: `/api/health`,
        db: `/api/health`,
        voyagerApi: `/api/health/voyager`,
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
    } catch (error) {
        console.error(`Health check failed for voyagerApi:`, error);
        data.voyagerApi = 0;
    }

    return { data, endpoints };
}
