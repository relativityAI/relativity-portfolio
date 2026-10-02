// Dump the stored skill_outputs of a run for debugging.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const runId = process.argv[2] || "710b6d30-7326-492b-ad8e-daf0d27cbac1";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: run, error } = await db.from("analysis_runs").select("*").eq("id", runId).single();
if (error || !run) {
  console.log("fetch error:", error?.message);
  process.exit(1);
}
console.log("status:", run.status, "| total_score:", run.total_score, "| coverage:", run.coverage, "| error:", run.error);
const outs = run.skill_outputs || [];
console.log("skill_outputs:", outs.length);
for (const o of outs) {
  console.log("\n=== skill:", o.skill_name, "| id:", o.skill_id, "| error:", o.error || "(none)", "| score:", o.score_0_100, "| coverage:", o.coverage, "| scored_by:", o.scored_by);
  console.log("  findings:", (o.findings || []).length, " verdicts:", (o.verdicts || []).length, " chart_requests:", (o.chart_requests || []).length, " tools_used:", JSON.stringify(o.tools_used || []));
  for (const v of o.verdicts || []) {
    console.log("   -", JSON.stringify(v.verdict), "|", String(v.anchor).slice(0, 60), "|", String(v.evidence).slice(0, 90));
  }
  for (const f of (o.findings || []).slice(0, 3)) {
    console.log("   f:", String(f.title).slice(0, 80), "|", String(f.detail).slice(0, 90));
  }
}
const report = run.report;
if (report) {
  console.log("\nreport blocks:", (report.blocks || []).map((b) => b.type + (b.chartType ? ":" + b.chartType : "")).join(", "));
  console.log("report source:", report.source, "| heroPct:", report.heroPct);
} else {
  console.log("\nreport: null");
}
