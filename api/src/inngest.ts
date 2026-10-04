import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "relativity-portfolio" });

export const kbIngestFn = inngest.createFunction(
  {
    id: "kb-ingest",
    name: "KB Ingest (chunks + events)",
    triggers: [{ event: "kb/ingest.requested" }],
    concurrency: [{ key: "event.data.symbol + '-' + (event.data.source || 'NSE')", limit: 1 }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { symbol, source, documents, announcements } = event.data as {
      symbol: string;
      source: string;
      documents?: { title?: string; text: string; kind?: string }[];
      announcements?: { heading: string; date?: string; text?: string }[];
    };

    await step.run("ingest-docs", async () => {
      const out = { chunks: 0, events: 0 };
      for (const doc of documents || []) {
        const text = doc.text || doc.title || "";
        if (!text) continue;
        const { persistChunks } = await import("./kb/store.js");
        const { docHash } = await import("./kb/chunks.js");
        const res = await persistChunks({
          symbol,
          source,
          doc_hash: docHash(text, doc.kind || "filing", doc.title || null),
          kind: doc.kind || "filing",
          text,
          as_of: null,
          source_ref: doc.title || null,
        });
        out.chunks += res.inserted;
      }
      return out;
    });

    await step.run("ingest-events", async () => {
      let events = 0;
      for (const a of announcements || []) {
        const { persistChunks, ingestEvent } = await import("./kb/store.js");
        void persistChunks;
        const res = await ingestEvent({
          symbol,
          source,
          text: a.text || a.heading,
          as_of: a.date || null,
          source_ref: a.heading || null,
        });
        if (!res.skipped) events++;
      }
      return { events };
    });

    return { symbol, source };
  }
);
// ---- v2 KB ingestion (plan §6.4) ----
// Triggered after pulls and lazily at run time for missing docs. Idempotent by
// doc_hash; safe to fan out for the same symbol.
