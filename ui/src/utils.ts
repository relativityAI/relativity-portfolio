import axios from "axios";

export const runHealthCheck = async () => {
    // Base discovery URL
    const API_BASE = import.meta.env.VITE_RELATIVITY_API || `http://${window.location.hostname}:8080`;
    const VOYAGER_BASE = import.meta.env.VITE_VOYAGER_API;
    const NEBULA_BASE = import.meta.env.VITE_NEBULA_API;

    // Default data structure
    const data = {
        api: 0,
        db: 0,
        voyagerApi: 0,
        nebulaApi: 0,
    };

    // Initial endpoints (can be overridden by discovery)
    let endpoints = {
        api: `${API_BASE}/`,
        db: `${API_BASE}/db`,
        voyagerApi: VOYAGER_BASE || `${API_BASE}/voyager`, 
        nebulaApi: NEBULA_BASE || `${API_BASE}/nebula`
    };

    // Try to discover ports and potentially distinct bases from backend
    try {
        const configRes = await axios.get(`${API_BASE}/services`, { timeout: 2000 });
        const config = configRes.data;
        
        // If we don't have explicit env vars, use the discovered ports on the current host
        if (!VOYAGER_BASE) {
            endpoints.voyagerApi = `http://${window.location.hostname}:${config.voyager.external}/`;
        }
        if (!NEBULA_BASE) {
            endpoints.nebulaApi = `http://${window.location.hostname}:${config.nebula.external}/`;
        }
    } catch (e) {
        console.warn("Dynamic service discovery failed, using fallback endpoints:", e);
    }

    const check = async (key: keyof typeof data, url: string) => {
        try {
            const response = await axios.get(url, { timeout: 3000 });
            data[key] = response.data.ok || 0;
        } catch (error) {
            console.error(`Health check failed for ${key}:`, error);
            data[key] = 0;
        }
    };

    await Promise.all([
        check('api', endpoints.api),
        check('db', endpoints.db),
        check('voyagerApi', endpoints.voyagerApi),
        check('nebulaApi', endpoints.nebulaApi)
    ]);

    return { data, endpoints };
}


export const searchEndpoint = async (query: string, url: string) => {

    let options = []

    await axios.get(`${url}?query=${query}`)
        .then((response) => {
            options = response.data
        })
        .catch((error) => {
            console.log(error)
        })

    return options

}

