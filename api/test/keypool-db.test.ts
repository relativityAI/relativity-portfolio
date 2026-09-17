import { describe, it, expect, vi, beforeEach } from "vitest";
import { KeyPool } from "../src/keypool.js";

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock("../src/db.js", () => ({ getDb: () => ({ from: () => ({ upsert }) }) }));

describe("KeyPool api_usage persistence", () => {
  beforeEach(() => upsert.mockReset());

  function pool() {
    return new KeyPool({
      serverKeys: { gemini: ["k1"] },
      cooldownMs: 1000,
    });
  }

  it("upserts aggregated usage rows to api_usage", async () => {
    const kp = pool();
    kp.recordUsage({ provider: "gemini", keyRef: "server:0", modelId: "gemini/x", requests: 1, tokensIn: 10, tokensOut: 20 });
    kp.recordUsage({ provider: "gemini", keyRef: "server:0", modelId: "gemini/x", requests: 1, tokensIn: 5, tokensOut: 7 });
    upsert.mockResolvedValue({ error: null });

    await kp.flushUsage();

    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), provider: "gemini", key_ref: "server:0", model_id: "gemini/x", requests: 2, tokens_in: 15, tokens_out: 27 }),
      ],
      expect.objectContaining({ onConflict: "day,provider,key_ref,model_id" }),
    );
  });

  it("tallies failures via markFailure into the persisted row", async () => {
    const kp = pool();
    kp.markFailure("gemini", "server:0");
    kp.markFailure("gemini", "server:0");
    upsert.mockResolvedValue({ error: null });

    await kp.flushUsage();

    const row = upsert.mock.calls[0][0][0];
    expect(row.failures).toBe(2);
  });

  it("retains rows and retries when the upsert fails", async () => {
    const kp = pool();
    kp.recordUsage({ provider: "gemini", keyRef: "server:0", modelId: "gemini/x", requests: 1 });
    upsert.mockRejectedValueOnce(new Error("db down"));

    await kp.flushUsage();

    // rows kept; a later flush writes them
    upsert.mockResolvedValue({ error: null });
    await kp.flushUsage();
    expect(upsert.mock.calls[0][0]).toHaveLength(1);
    expect(upsert.mock.calls[1][0][0].requests).toBe(1);
  });
});