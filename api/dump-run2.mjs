// Dump full stored skill output + steps trace.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const runId = process.argv[2] || "710b6d30-7326-492b-ad8e-daf0d27cbac1";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: run } = await db.from("analysis_runs").select("*").eq("id", runId).single();
const o = (run.skill_outputs || [])[0];
console.log("FULL skill_output keys:", Object.keys(o));
console.log(JSON.stringify(o, null, 1).slice(0, 6000));
console.log("\n\n=== steps ===");
console.log(JSON.stringify(run.steps, null, 1).slice(0, 9000));
