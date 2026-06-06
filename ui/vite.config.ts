import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src")
        }
    },
    server: {
        host: true,  
        port: 5173,
        proxy: {
            "/voyager-api": {
                target: process.env.VITE_VOYAGER_API_URL || "http://localhost:8001",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/voyager-api/, "")
            },
            "/nebula-api": {
                target: process.env.VITE_NEBULA_API_URL || "http://localhost:8002",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/nebula-api/, "")
            },
            "/api": {
                target: process.env.VITE_API_URL || "http://localhost:8080",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, "")
            }
        }
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        return id.toString().split('node_modules/')[1].split('/')[0].toString();
                    }
                }
            }
        }
    }
});
