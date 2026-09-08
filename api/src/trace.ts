import { EventEmitter } from "node:events";

export type TraceEventType =
  | "thought"
  | "tool_call"
  | "tool_result"
  | "decision"
  | "step"
  | "log";

export interface TraceEvent {
  seq: number;
  ts: number;
  type: TraceEventType;
  /** Qualitative parameter label (or step key) this event belongs to. */
  key: string;
  /** Human-readable text: reasoning delta, decision note, step detail. */
  text?: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  status?: "pending" | "running" | "completed" | "failed" | "skipped" | "OK" | "ERR";
  duration_ms?: number;
  score?: number;
  value?: unknown;
  label?: string;
}

const BUFFER_CAP = 1024;

/**
 * In-process pub/sub that relays trace events from any executor (local runner
 * or Inngest function) to SSE subscribers. Lives in this Express process, so
 * every execution path publishes to the same hub regardless of how it runs.
 * Keeps a small per-run ring buffer so a subscriber connecting mid-run can
 * replay events it should not miss.
 */
export class TraceHub {
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<string, TraceEvent[]>();

  subscribe(runId: string, listener: (event: TraceEvent) => void): () => void {
    const buffered = this.buffers.get(runId);
    if (buffered) {
      for (const ev of buffered) listener(ev);
    }
    this.emitter.on(runId, listener);
    return () => this.emitter.off(runId, listener);
  }

  publish(runId: string, event: TraceEvent): void {
    let buf = this.buffers.get(runId);
    if (!buf) {
      buf = [];
      this.buffers.set(runId, buf);
    }
    buf.push(event);
    if (buf.length > BUFFER_CAP) buf.splice(0, buf.length - BUFFER_CAP);
    this.emitter.emit(runId, event);
  }

  reset(runId: string): void {
    this.buffers.delete(runId);
    this.emitter.removeAllListeners(runId);
  }
}

export const traceHub = new TraceHub();

let seq = 0;
export function nextSeq(): number {
  return ++seq;
}

/**
 * Per-run trace collector shared by the local executor and the Inngest
 * function. Keeps the full event list in memory, publishes every event to the
 * hub for live SSE delivery, and persists to the DB on a throttle (so a burst
 * of reasoning deltas doesn't hammer Postgres) plus on finalize.
 */
export class TraceCollector {
  private readonly events: TraceEvent[] = [];
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private lastPersist = 0;

  constructor(
    private readonly runId: string,
    private readonly persist: (events: TraceEvent[]) => Promise<void>,
    private readonly throttleMs = 1500,
  ) {}

  push(
    type: TraceEventType,
    key: string,
    fields: Omit<TraceEvent, "seq" | "ts" | "type" | "key"> = {},
  ): TraceEvent {
    const event: TraceEvent = { seq: nextSeq(), ts: Date.now(), type, key, ...fields };
    this.events.push(event);
    traceHub.publish(this.runId, event);
    this.schedulePersist();
    return event;
  }

  snapshot(): TraceEvent[] {
    return this.events.slice();
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.timer) return;
    const elapsed = Date.now() - this.lastPersist;
    const wait = Math.max(0, this.throttleMs - elapsed);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.lastPersist = Date.now();
    await this.persist(this.snapshot());
  }
}