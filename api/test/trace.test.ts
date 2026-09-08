import { describe, it, expect, vi } from "vitest";
import { TraceHub, TraceCollector, traceHub, nextSeq } from "../src/trace.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("TraceHub", () => {
  it("replays buffered events to a late subscriber", async () => {
    const hub = new TraceHub();
    hub.publish("r1", { seq: 1, ts: 1, type: "thought", key: "p", text: "a" });
    hub.publish("r1", { seq: 2, ts: 2, type: "thought", key: "p", text: "b" });

    const seen: number[] = [];
    hub.subscribe("r1", (e) => seen.push(e.seq));
    await sleep(0);
    expect(seen).toEqual([1, 2]);
  });

  it("delivers live events to existing subscribers only", async () => {
    const hub = new TraceHub();
    const seen: string[] = [];
    hub.subscribe("r1", (e) => seen.push(e.text || ""));

    hub.publish("r1", { seq: 1, ts: 1, type: "thought", key: "p", text: "live" });
    expect(seen).toEqual(["live"]);
  });

  it("unsubscribes cleanly", async () => {
    const hub = new TraceHub();
    const seen: string[] = [];
    const off = hub.subscribe("r1", (e) => seen.push(e.text || ""));
    off();
    await sleep(0);
    hub.publish("r1", { seq: 1, ts: 1, type: "thought", key: "p", text: "nope" });
    expect(seen).toEqual([]);
  });

  it("reset drops subscribers and clears the buffer", async () => {
    const hub = new TraceHub();
    hub.publish("r1", { seq: 1, ts: 1, type: "thought", key: "p", text: "a" });
    const live: number[] = [];
    hub.subscribe("r1", (e) => live.push(e.seq));
    live.length = 0; // drop buffered replay; only assert post-reset behavior
    hub.reset("r1");
    hub.publish("r1", { seq: 2, ts: 2, type: "thought", key: "p", text: "b" });
    await sleep(0);
    // reset removed the subscriber, so it never sees the post-reset live event.
    expect(live).toEqual([]);
  });
});

describe("TraceCollector", () => {
  it("accumulates events and throttles persistence", async () => {
    const persist = vi.fn(async () => {});
    const collector = new TraceCollector("r1", persist, 50);

    collector.push("thought", "p1", { text: "a" });
    collector.push("tool_call", "p1", { tool: "tool", args: { x: 1 } });
    collector.push("decision", "p1", { score: 72 });

    expect(collector.snapshot()).toHaveLength(3);
    expect(collector.snapshot()[0]).toMatchObject({ type: "thought", key: "p1", text: "a" });

    // Throttled write happens after >50ms
    await sleep(120);
    expect(persist).toHaveBeenCalledTimes(1);
    const events = persist.mock.calls[0][0];
    expect(events).toEqual(collector.snapshot());
  });

  it("flush immediately persists without waiting for throttle", async () => {
    const persist = vi.fn(async () => {});
    const collector = new TraceCollector("r1", persist, 5000);
    collector.push("thought", "p1", { text: "x" });
    await collector.flush();
    expect(persist).toHaveBeenCalledTimes(1);
    // Second flush with no new events is a no-op
    await collector.flush();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("publishes every event to the shared hub", async () => {
    const persist = vi.fn(async () => {});
    const run = `pub-test-${nextSeq()}`;
    const events: any[] = [];
    // Reset any leftover state for this run id first.
    traceHub.reset(run);
    const off = traceHub.subscribe(run, (e) => events.push(e));

    const collector = new TraceCollector(run, persist, 100000);
    collector.push("thought", "p1", { text: "live" });
    collector.push("tool_call", "p1", { tool: "t", args: { a: 1 } });
    await sleep(0);
    off();

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "thought", key: "p1", text: "live" });
    expect(events[1]).toMatchObject({ type: "tool_call", tool: "t" });
  });
});