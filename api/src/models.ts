import { readFileSync } from "node:fs";
import YAML from "yaml";
import { config } from "./config.js";

export interface ModelEntry {
  id: string;
  provider: string;
  name: string;
  priority: number;
}

let cache: ModelEntry[] | null = null;

export function getModels(): ModelEntry[] {
  if (!cache) {
    const raw = readFileSync(config.modelsFile, "utf8");
    const parsed = YAML.parse(raw) as { models: ModelEntry[] };
    cache = (parsed.models || [])
      .slice()
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  }
  return cache;
}

export function getModelIds(): string[] {
  return getModels().map((m) => m.id);
}
