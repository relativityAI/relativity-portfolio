import "dotenv/config";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const r = await fetch(`${url}/rest/v1/runs?select=id,status,model,error,trace,created_at&order=created_at.desc&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const body = await r.json() as any;
const run = Array.isArray(body) ? body[0] : body;
console.log("HTTP", r.status, "raw:", JSON.stringify(body).slice(0, 300));
console.log("id", run?.id, "| status", run?.status, "| model", run?.model);
console.log("error:", String(run?.error).slice(0, 300));
const t = run?.trace || [];
console.log("trace events:", t.length, "| by type:", JSON.stringify(t.reduce((a: any, e: any) => (a[e.type] = (a[e.type] || 0) + 1, a), {})));
for (const e of t.slice(0, 12)) console.log(" -", e.type, "|", String(e.text ?? e.tool ?? "").slice(0, 90));
