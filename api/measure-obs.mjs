// Measure the stored get_technicals observation size (is it >200KB?),
// and check the technical-analysis skill's declared charts.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const runId = process.argv[2] || "710b6d30-7326-492b-ad8e-daf0d27cbac1";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: run } = await db.from("analysis_runs").select("*").eq("id", runId).single();
const o = (run.skill_outputs || [])[0];
const obs = (o.raw_observations || [])[0];
console.log("observation result length:", obs?.result?.length);
console.log("parses cleanly:", (() => { try { JSON.parse(obs.result); return true; } catch { return false; } })());
console.log("first 120 chars:", obs?.result?.slice(0, 120));
console.log("last 120 chars:", obs?.result?.slice(-120));

// The agent's skill config: fetch the agent row to see skill refs, then the skill def.
const agents = await db.from("agent_configs").select("*").limit(5);
console.log("\nagent_configs:", agents.data?.map((a) => a.id));
