/** dbg-trace <run-id> — dump the run trace events (compact). */
import { getDb } from "./src/db.js";

const db = getDb();
const runId = process.argv[2];
const { data, error } = await db.from("analysis_runs").select("trace, report, steps").eq("id", runId).single();
if (error || !data) { console.error("not found:", error?.message); process.exit(1); }
const trace = typeof data.trace === "string" ? JSON.parse(data.trace) : data.trace;
console.log("=== TRACE events:", Array.isArray(trace) ? trace.length : typeof trace, "===");
if (Array.isArray(trace)) {
  for (const ev of trace) {
    const t = ev.type || "?";
    const ts = new Date(ev.ts || 0).toISOString().slice(11, 19);
    if (t === "tool_call") console.log(`${ts} CALL ${ev.tool} ${JSON.stringify(ev.args ?? ev.input ?? {}).slice(0, 150)}`);
    else if (t === "tool_result") console.log(`${ts} RESULT ${ev.tool} [${ev.status}] ${JSON.stringify(ev.result ?? "").slice(0, 200)}`);
    else if (t === "thought" || t === "log") console.log(`${ts} ${t.toUpperCase()} ${String(ev.text ?? ev.data?.text ?? "").slice(0, 300)}`);
    else console.log(`${ts} ${t} ${JSON.stringify(ev).slice(0, 200)}`);
  }
}
const report = typeof data.report === "string" ? data.report : JSON.stringify(data.report);
console.log("\n=== REPORT (first 3000) ===\n" + (report || "").slice(0, 3000));
