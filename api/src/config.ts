import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 8080),
  // Supabase
  supabaseProjectUrl: process.env.SUPABASE_PROJECT_URL || "",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  // AES-256-GCM key for encrypting stored API keys (64 hex chars = 32 bytes)
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  // Voyager
  voyagerUrl: process.env.VOYAGER_URL || "https://voyager-1hpq.onrender.com",
  voyagerAdminKey: process.env.VOYAGER_ADMIN_KEY || "",
  voyagerRpm: Number(process.env.VOYAGER_RPM || 60),
  // Paths
  assetsDir: path.resolve(__dirname, "..", "assets"),
  modelsFile: path.resolve(__dirname, "..", "config", "models.yaml"),
  // Limits
  maxToolSteps: 10,
  rateLimitPerMin: 10,
  tavilyUrl: "https://api.tavily.com/search",
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434/v1",
};
