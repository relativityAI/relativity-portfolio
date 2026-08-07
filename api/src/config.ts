import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 8080),
  mongodbUrl: process.env.MONGODB_URL || "mongodb://root:example@localhost:27017/",
  mongodbDb: process.env.MONGODB_DB_NAME || "relativity",
  voyagerUrl: process.env.VOYAGER_URL || "http://localhost:8001",
  assetsDir: path.resolve(__dirname, "..", "assets"),
  modelsFile: path.resolve(__dirname, "..", "config", "models.yaml"),
  maxToolSteps: 10,
  rateLimitPerMin: 10,
  tavilyUrl: "https://api.tavily.com/search",
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434/v1",
};
