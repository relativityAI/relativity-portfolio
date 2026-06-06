import axios from "axios";

export const runHealthCheck = async () => {
    // Default data structure
    const data = {
        api: 0,
        db: 0,
        voyagerApi: 0,
        nebulaApi: 0,
    };

    let endpoints = {
        api: `/api/`,
        db: `/nebula-api/list-profiles`,
        voyagerApi: `/voyager-api/`, 
        nebulaApi: `/nebula-api/`
    };

    const check = async (key: keyof typeof data, url: string) => {
        try {
            const response = await axios.get(url, { timeout: 3000 });
            // More robust check: if the service responds at all, consider it up.
            data[key] = (response.status === 200 || response.data.ok) ? 1 : 0;
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

    let options: any[] = []

    await axios.get(`${url}?query=${query}`)
        .then((response) => {
            options = response.data
        })
        .catch((error) => {
            console.log(error)
        })

    return options

}

