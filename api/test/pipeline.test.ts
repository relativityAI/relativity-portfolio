import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { runAnalysis, type RunStore } from "../src/pipeline.js";
import { DONE_MARKER } from "../src/iterative-agent.js";

/** A clean text stream for the AI SDK mock. */
function textStream(text: string) {
  return () =>
    Promise.resolve({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          c.enqueue({ type: "text-start", id: "t0" });
          c.enqueue({ type: "text-delta", id: "t0", delta: text });
          c.enqueue({ type: "text-end", id: "t0" });
          c.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } });
          c.close();
        },
      }),
    });
}

function fakeStore(updateImpl?: (patch: Record<string, unknown>) => Promise<{ error: { message: string } | null }>) {
  const calls: { op: "insert" | "update"; row?: Record<string, unknown>; patch?: Record<string, unknown> }[] = [];
  const store: RunStore = {
    insert: async (row) => {
      calls.push({ op: "insert", row });
      return { error: null };
    },
    update: async (_id, patch) => {
      calls.push({ op: "update", patch });
      return updateImpl ? updateImpl(patch) : { error: null };
    },
  };
  return { store, calls };
}

const baseReq = {
  userId: "user-1",
  symbol: "RELIANCE",
  skillId: "sk-1",
  source: "NSE",
  shareName: "RELIANCE",
  agentName: "Test Skill",
  skillMarkdown: "# Skill",
  modelId: "gpt-4o",
  onStarted: () => {},
};

describe("runAnalysis", () => {
  it("inserts PENDING, responds 202, then marks COMPLETED with the report", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: () =>
        textStream(
          ++calls === 1
            ? "Starting research, no answer yet."
            : `Final answer.\n${DONE_MARKER}`,
        )(),
    });
    const { store, calls: ops } = fakeStore();
    let startedId = "";

    await runAnalysis({ ...baseReq, model: model as any, store, onStarted: (id) => { startedId = id; } });

    expect(ops[0].op).toBe("insert");
    expect(ops[0].row).toMatchObject({ status: "PENDING", symbol: "RELIANCE", run_mode: "iterative", skill_id: "sk-1" });
    expect(startedId).toBe(ops[0].row!.id);

    await vi.waitFor(() => {
      const final = ops.find((c) => c.op === "update" && c.patch?.status === "COMPLETED");
      expect(final).toBeDefined();
    });
    const final = ops.find((c) => c.op === "update" && c.patch?.status === "COMPLETED")!;
    expect(final.patch!.report.blocks[1]).toMatchObject({ text: "Final answer." });
    expect(final.patch!.error).toBeNull();
    expect(typeof final.patch!.duration).toBe("number");
    expect(ops.find((c) => c.op === "update" && c.patch?.status === "FAILED")).toBeUndefined();

    const traceOps = ops.filter((c) => c.op === "update" && Array.isArray(c.patch?.trace));
    expect(traceOps.length).toBeGreaterThan(0);
    expect(JSON.stringify(traceOps.at(-1)!.patch)).toContain("Completed after");
  });

  it("marks FAILED when the agent never completes", async () => {
    const model = new MockLanguageModelV4({ doStream: textStream("still thinking...") });
    const { store, calls: ops } = fakeStore();

    await runAnalysis({ ...baseReq, model: model as any, store });

    await vi.waitFor(() => {
      expect(ops.find((c) => c.op === "update" && c.patch?.status === "FAILED")).toBeDefined();
    });
    const final = ops.find((c) => c.op === "update" && c.patch?.status === "FAILED")!;
    expect(final.patch!.error).toMatch(/did not complete/i);
  });

  it("throws and never starts when the insert fails", async () => {
    const model = new MockLanguageModelV4({ doStream: textStream("x") });
    const store: RunStore = {
      insert: async () => ({ error: { message: "boom" } }),
      update: async () => ({ error: null }),
    };
    let started = false;

    await expect(
      runAnalysis({ ...baseReq, model: model as any, store, onStarted: () => { started = true; } }),
    ).rejects.toThrow("boom");
    expect(started).toBe(false);
  });

  it("retries without artifacts when Supabase reports the new columns missing (PGRST204)", async () => {
    const model = new MockLanguageModelV4({
      doStream: () => textStream(`Done.\n${DONE_MARKER}`)(),
    });
    let retried = false;
    const { store, calls: ops } = fakeStore((patch) => {
      if (patch && "artifacts" in patch && !retried) {
        retried = true;
        return Promise.resolve({ error: { message: 'column "artifacts" of relation "analysis_runs" does not exist (PGRST204)' } });
      }
      return Promise.resolve({ error: null });
    });

    await runAnalysis({ ...baseReq, model: model as any, store });

    await vi.waitFor(() => {
      expect(ops.filter((c) => c.op === "update" && c.patch?.status === "COMPLETED")).toHaveLength(2);
    });
    const failedUpdate = ops.find((c) => c.op === "update" && c.patch?.artifacts !== undefined)!;
    const retry = ops.filter((c) => c.op === "update" && c.patch?.status === "COMPLETED").at(-1)!;
    expect(retry.patch!.artifacts).toBeUndefined();
  });
});
