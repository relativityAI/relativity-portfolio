/**
 * web_fetch: http/https gate, readable-text extraction, and the workspace
 * save (full text at /knowledge_base/tool-output/<hash>.md, head inline).
 */
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../src/harness/workspace/fs.js";
import { webFetchTool } from "../src/harness/tools/builtins/webfetch.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ctx = { symbol: "AAPL", source: "SEC" };

describe("web_fetch", () => {
  it("rejects non-http urls without ever fetching", async () => {
    let called = 0;
    globalThis.fetch = (async () => {
      called++;
      return new Response("");
    }) as typeof fetch;
    const out = (await webFetchTool(new Workspace()).execute({ url: "file:///etc/passwd" }, ctx)) as any;
    expect(out.error).toContain("http");
    expect(called).toBe(0);
  });

  it("extracts readable text (scripts stripped), saves it, returns head + path", async () => {
    const html =
      `<html><head><title>FY2025</title></head><body><script>track();</script>` +
      `<p>Revenue &amp; profit rose 12% to $416B.</p></body></html>`;
    globalThis.fetch = (async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    const ws = new Workspace();
    const out = (await webFetchTool(ws).execute({ url: "https://example.com/fy2025" }, ctx)) as any;
    expect(out.path).toMatch(/^\/knowledge_base\/tool-output\/[0-9a-f]{16}\.md$/);
    expect(out.head).toContain("Revenue & profit rose 12% to $416B.");
    expect(out.head).not.toContain("track()");
    expect(out.head).toContain("[UNTRUSTED web fetch");
    expect(ws.read(out.path)).toContain("$416B");
    expect(out.bytes).toBeGreaterThan(0);
  });

  it("refuses non-text content instead of saving mojibake", async () => {
    globalThis.fetch = (async () =>
      new Response("%PDF-1.4", { status: 200, headers: { "content-type": "application/pdf" } })) as typeof fetch;
    const ws = new Workspace();
    const out = (await webFetchTool(ws).execute({ url: "https://example.com/10k.pdf" }, ctx)) as any;
    expect(out.error).toContain("content-type");
    expect(ws.stats().files).toBe(0);
  });
});
