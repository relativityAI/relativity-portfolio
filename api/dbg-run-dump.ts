/** dbg-run-dump <run-id> — dump stored skill outputs for a run. */
import { getDb } from "./src/db.js";

const db = getDb();
const runId = process.argv[2];
const { data, error } = await db.from("analysis_runs").select("*").eq("id", runId).single();
if (error || !data) { console.error("run not found:", error?.message); process.exit(1); }
console.log("run:", data.id, "status:", data.status, "model:", data.model, "symbol:", data.symbol, data.source);
console.log("error:", data.error);
const cols = Object.keys(data);
const skillCols = cols.filter((c) => /skill|output|result/i.test(c));
console.log("columns:", cols.join(", "));
for (const c of skillCols) {
  const v = (data as any)[c];
  if (!v) continue;
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  console.log(`\n===== ${c} (${s.length} chars) =====`);
  console.log(s.slice(0, 12000));
}
