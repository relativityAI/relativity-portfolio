import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 8080),
  mongodbUrl: process.env.MONGODB_URL || "mongodb://root:example@localhost:27017/",
  mongodbDb: process.env.MONGODB_DB_NAME || "relativity",
  // Supabase project URL used to verify access tokens via the public JWKS
  // endpoint (e.g. https://<project-ref>.supabase.co). Required for auth.
  supabaseProjectUrl: process.env.SUPABASE_PROJECT_URL || "",
  voyagerUrl: process.env.VOYAGER_URL || "https://voyager-1hpq.onrender.com",
  // Optional server-side fallback key. Users normally provide their own key in
  // Settings (sent as X-Voyager-Key); this is only used when none is set.
  voyagerApiKey: process.env.VOYAGER_API_KEY || "",
  // Requests per minute the Voyager key allows (used for a client throttle).
  voyagerRpm: Number(process.env.VOYAGER_RPM || 60),
  assetsDir: path.resolve(__dirname, "..", "assets"),
  modelsFile: path.resolve(__dirname, "..", "config", "models.yaml"),
  maxToolSteps: 10,
  rateLimitPerMin: 10,
  tavilyUrl: "https://api.tavily.com/search",
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434/v1",
};
