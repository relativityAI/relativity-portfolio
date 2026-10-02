import { readFileSync } from "fs";
import { createRequire } from "module";
const require2 = createRequire(import.meta.url);

// Reuse production code paths via tsx-free approach: replicate buildTools + skill prompt exactly.
const env = readFileSync(".env", "utf8");
const keyMatch = env.match(/GEMINI_API_KEYS\s*=\s*(.+)/);
const apiKey = keyMatch ? keyMatch[1].split(",")[0].trim() : "";

// Import production modules via the built dist? No dist. Use tsx.
const { execSync } = await import("child_process");
