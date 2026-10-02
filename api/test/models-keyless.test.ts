import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/config.js", () => ({
  config: {
    serverKeys: {},
    serverModels: {},
    modelsFile: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "models.yaml"),
  },
  DEFAULT_DAILY_REQUESTS: {},
}));

import { getAvailableModelsForUser } from "../src/models.js";

describe("keyless users on the server-free model list", () => {
  it("hides paid providers (openai/anthropic) when the user has no keys", async () => {
    const models = await getAvailableModelsForUser({});
    expect(models.some((m) => m.startsWith("openai/"))).toBe(false);
    expect(models.some((m) => m.startsWith("anthropic/"))).toBe(false);
  });

  it("exposes the free-tier providers without any user key", async () => {
    const models = await getAvailableModelsForUser({});
    for (const prefix of ["gemini/", "groq/", "cerebras/", "openrouter/", "mistral/", "nvidia/", "cohere/", "zai/", "ollama/"]) {
      expect(models.some((m) => m.startsWith(prefix))).toBe(true);
    }
  });

  it("hides free-tier curated entries once the user has their own keys for other providers only", async () => {
    const models = await getAvailableModelsForUser({ openai: "user-openai" });
    expect(models.some((m) => m.startsWith("openai/"))).toBe(true);
    // Keyless/server-free providers stay available alongside the user's keys.
    expect(models.some((m) => m.startsWith("groq/"))).toBe(true);
    // ...but the model list must not silently include providers nobody can run.
    expect(models.every((m) => {
      const p = m.split("/")[0];
      return p === "openai" || p === "ollama" || p === "groq" || p === "gemini" || p === "cerebras" || p === "openrouter" ||
        p === "mistral" || p === "nvidia" || p === "cohere" || p === "zai";
    })).toBe(true);
  });
});
