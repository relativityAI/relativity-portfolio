import { describe, it, expect } from "vitest";
import { KeyPool } from "../src/keypool.js";

function pool() {
  return new KeyPool({
    serverKeys: { gemini: ["server-gemini-0", "server-gemini-1"], openai: ["server-openai-0"] },
    serverModels: { gemini: ["gemini/gemini-3.5-flash-lite"], openai: ["openai/gpt-4o-mini"] },
    dailyCaps: { gemini: 100, openai: 100 },
    cooldownMs: 60_000,
  });
}

describe("user-key priority over the server pool", () => {
  it("always returns the user's key while it is configured (no rotation to server)", () => {
    const kp = pool();
    for (let i = 0; i < 5; i++) {
      const { apiKey, keyRef } = kp.pickKey("gemini/gemini-3.5-flash-lite", { gemini: "user-gemini" });
      expect(keyRef).toBe("user");
      expect(apiKey).toBe("user-gemini");
    }
  });

  it("never falls back to a server key when the user key fails", () => {
    const kp = pool();
    kp.markFailure("gemini", "user");
    for (let i = 0; i < 3; i++) {
      const { apiKey, keyRef } = kp.pickKey("gemini/gemini-3.5-flash-lite", { gemini: "user-gemini" });
      expect(keyRef).toBe("user");
      expect(apiKey).toBe("user-gemini");
    }
  });

  it("leaves the server pool untouched while the user key is in play", () => {
    const kp = pool();
    for (let i = 0; i < 4; i++) kp.pickKey("gemini/gemini-3.5-flash-lite", { gemini: "user-gemini" });
    expect(kp.serverRequests("gemini")).toBe(0);
  });
});