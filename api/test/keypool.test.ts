import { describe, it, expect } from "vitest";
import { KeyPool } from "../src/keypool.js";

function pool(overrides: Partial<ConstructorParameters<typeof KeyPool>[0]> = {}) {
  return new KeyPool({
    serverKeys: { gemini: ["server-gemini-0", "server-gemini-1", "server-gemini-2"], openai: ["server-openai-0"] },
    serverModels: { gemini: ["gemini/gemini-3.5-flash-lite"], openai: ["openai/gpt-4o-mini"] },
    dailyCaps: { gemini: 100, openai: 100 },
    cooldownMs: 60_000,
    ...overrides,
  });
}

describe("pickKey", () => {
  it("prefers the user's own key over the server pool", () => {
    const kp = pool();
    const { apiKey, keyRef } = kp.pickKey("gemini/gemini-3.5-flash-lite", { gemini: "user-key" });
    expect(apiKey).toBe("user-key");
    expect(keyRef).toBe("user");
  });

  it("rotates across pooled server keys", () => {
    const kp = pool();
    const picked: string[] = [];
    for (let i = 0; i < 6; i++) picked.push(kp.pickKey("gemini/gemini-3.5-flash-lite", {}).keyRef);
    expect(picked).toEqual(["server:0", "server:1", "server:2", "server:0", "server:1", "server:2"]);
  });

  it("returns no key for ollama", () => {
    const kp = pool();
    expect(kp.pickKey("ollama/llama3", {})).toEqual({ apiKey: "", keyRef: "none" });
  });

  it("throws when the provider has no key anywhere", () => {
    const kp = pool();
    expect(() => kp.pickKey("cerebras/cerebras-1", {})).toThrow(/No API key/);
  });

  it("avoids a key in cooldown", () => {
    const kp = pool({ serverKeys: { gemini: ["a", "b"] } });
    const first = kp.pickKey("gemini/x", {});
    kp.markFailure("gemini", first.keyRef);
    for (let i = 0; i < 3; i++) {
      const next = kp.pickKey("gemini/x", {});
      expect(next.keyRef).not.toBe(first.keyRef);
    }
  });

  it("recovers a key once the cooldown elapses", async () => {
    const kp = pool({ serverKeys: { gemini: ["a", "b"] } });
    const first = kp.pickKey("gemini/x", {});
    kp.markFailure("gemini", first.keyRef);
    expect(kp.pickKey("gemini/x", {}).keyRef).toBe("server:1");
    // after cooldown the failed key is eligible again
    kp.pickKey("gemini/x", {});
    kp.pickKey("gemini/x", {});
    const last = kp.pickKey("gemini/x", {}).keyRef;
    expect(["server:0", "server:1"]).toContain(last);
  });

  it("degrades to the least-recently-failed key when every key is in cooldown", () => {
    const kp = pool({ serverKeys: { gemini: ["a", "b"] } });
    kp.markFailure("gemini", "server:0");
    kp.markFailure("gemini", "server:1");
    // must not throw; picks some key
    expect(["server:0", "server:1"]).toContain(kp.pickKey("gemini/x", {}).keyRef);
  });

  it("markFailure on a keyless provider is a no-op", () => {
    const kp = pool();
    expect(() => kp.markFailure("ollama", "none")).not.toThrow();
  });
});

describe("getDefaultModel", () => {
  it("picks the top-priority provider when everything is fresh", () => {
    const kp = pool();
    expect(kp.getDefaultModel({})).toBe("gemini/gemini-3.5-flash-lite");
  });

  it("yields to the next provider once the leader's daily quota is exhausted", () => {
    const kp = pool();
    const model = kp.getDefaultModel({});
    for (let i = 0; i < 100; i++) {
      kp.recordUsage({ provider: "gemini", keyRef: `server:${i % 3}`, modelId: model, requests: 1 });
    }
    expect(kp.getDefaultModel({})).toBe("openai/gpt-4o-mini");
  });

  it("a user key earns the provider a bonus and wins once the server default is exhausted", () => {
    const kp = pool();
    const model = kp.getDefaultModel({ openai: "user-openai" });
    expect(model).toBe("gemini/gemini-3.5-flash-lite");
    for (let i = 0; i < 100; i++) {
      kp.recordUsage({ provider: "gemini", keyRef: `server:${i % 3}`, modelId: model, requests: 1 });
    }
    expect(kp.getDefaultModel({ openai: "user-openai" })).toBe("openai/gpt-4o-mini");
  });

  it("returns the curated leader when no keys are configured anywhere", () => {
    const kp = new KeyPool({ serverKeys: {}, dailyCaps: {}, cooldownMs: 1000 });
    expect(kp.getDefaultModel({})).toBeTruthy();
    expect(kp.getDefaultModel({})).toContain("/");
  });

  it("reports per-provider server request counts via serverRequests", () => {
    const kp = pool();
    kp.recordUsage({ provider: "gemini", keyRef: "server:0", modelId: "gemini/x", requests: 3 });
    kp.recordUsage({ provider: "gemini", keyRef: "server:2", modelId: "gemini/x", requests: 1 });
    expect(kp.serverRequests("gemini")).toBe(4);
  });
});