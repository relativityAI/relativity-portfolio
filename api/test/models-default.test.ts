import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/config.js", () => ({
  config: {
    serverKeys: { gemini: ["server-gemini"], openai: ["server-openai"] },
    serverModels: {
      gemini: ["gemini/gemini-3.5-flash-lite"],
      openai: [], // server-keyed but no explicit list → curated YAML used
    },
    modelsFile: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "models.yaml"),
  },
  DEFAULT_DAILY_REQUESTS: { gemini: 1500, openai: 500 },
}));

import { getAvailableModelsForUser } from "../src/models.js";

describe("getAvailableModelsForUser with server key pools", () => {
  it("exposes server-keyed providers even when the user has no keys", async () => {
    const models = await getAvailableModelsForUser({});
    expect(models).toContain("gemini/gemini-3.5-flash-lite");
  });

  it("uses the explicit PROVIDER_MODELS list over the curated YAML for that provider", async () => {
    const models = await getAvailableModelsForUser({});
    expect(models[0]).toBe("gemini/gemini-3.5-flash-lite");
  });

  it("falls back to curated YAML for a keyed provider without an explicit list", async () => {
    const models = await getAvailableModelsForUser({});
    expect(models.some((m) => m.startsWith("openai/"))).toBe(true);
  });

  it("merges user-keyed providers in", async () => {
    const models = await getAvailableModelsForUser({ cerebras: "user-cerebras" });
    expect(models.some((m) => m.startsWith("cerebras/"))).toBe(true);
  });

  it("always keeps keyless ollama models visible", async () => {
    const models = await getAvailableModelsForUser({});
    expect(models.some((m) => m.startsWith("ollama/"))).toBe(true);
  });
});