/** dbg-recent-runs — show the latest analysis runs and their user/model/symbol. */
import { getDb } from "./src/db.js";
import { decrypt } from "./src/crypto.js";

const db = getDb();
const { data, error } = await db
  .from("analysis_runs")
  .select("id, user_id, symbol, source, model, status, created_at, error")
  .order("created_at", { ascending: false })
  .limit(8);
if (error) { console.error("failed:", error.message); process.exit(1); }
for (const r of data || []) {
  console.log(`${r.created_at}  ${r.id}  user=${r.user_id}  ${r.symbol}/${r.source}  model=${r.model}  status=${r.status}${r.error ? "  err=" + String(r.error).slice(0, 80) : ""}`);
}
// For the newest run's user, decrypt + test the stored voyager key.
const newest = (data || [])[0];
if (newest) {
  const { data: settings } = await db.from("user_settings").select("voyager_key_encrypted").eq("user_id", newest.user_id).single();
  if (settings?.voyager_key_encrypted) {
    const key = decrypt(settings.voyager_key_encrypted);
    console.log(`\nnewest run user ${newest.user_id} stored key: ${key.slice(0, 6)}…${key.slice(-4)} (${key.length} chars)`);
    const res = await fetch(`${process.env.VOYAGER_URL}/technicals?symbol=${newest.symbol}&source=${newest.source?.toLowerCase()}`, {
      headers: { "X-API-Key": key },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    console.log(`GET /technicals → ${res.status}: ${body.slice(0, 160)}`);
  } else {
    console.log(`\nnewest run user ${newest.user_id} has NO stored voyager key`);
  }
}
