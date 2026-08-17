/**
 * One-time migration: MongoDB Atlas → Supabase Postgres.
 *
 * Usage:
 *   MONGODB_URL="mongodb+srv://..." MONGODB_DB_NAME="relativity" \
 *   SUPABASE_URL="https://..." SUPABASE_SERVICE_ROLE_KEY="..." \
 *   npx tsx scripts/migrate-mongo-to-supabase.ts
 */

import { MongoClient } from "mongodb";
import { createClient } from "@supabase/supabase-js";

const MONGODB_URL = process.env.MONGODB_URL || "";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "relativity";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!MONGODB_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set MONGODB_URL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function migrate() {
  console.log("Connecting to MongoDB...");
  const mongo = new MongoClient(MONGODB_URL);
  await mongo.connect();
  const db = mongo.db(MONGODB_DB_NAME);

  console.log("Connecting to Supabase...");
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Agents ──────────────────────────────────────────────────────────
  const agents = await db.collection("agents").find({}).toArray();
  console.log(`Migrating ${agents.length} agents...`);
  for (const a of agents) {
    const doc = {
      id: String(a._id),
      user_id: a.user_id || "",
      name: a.name || "",
      source: a.source || "NSE",
      persona: a.persona || {},
      configuration: a.configuration || {},
      asset_evaluation: a.asset_evaluation || { qualitative: [], quantitative: [] },
      macro_evaluation: a.macro_evaluation || { qualitative: [], quantitative: [] },
      created_at: a.created_at || new Date().toISOString(),
      updated_at: a.updated_at || a.created_at || new Date().toISOString(),
    };
    const { error } = await supa.from("agents").upsert(doc, { onConflict: "id" });
    if (error) console.error(`  agent ${doc.id} error:`, error.message);
  }
  console.log("Agents done.");

  // ── Analysis runs ───────────────────────────────────────────────────
  const runs = await db.collection("analysis_runs").find({}).toArray();
  console.log(`Migrating ${runs.length} analysis runs...`);
  for (const r of runs) {
    const doc = {
      id: String(r._id),
      user_id: r.user_id || "",
      status: r.status || "PENDING",
      symbol: r.symbol || "",
      share_name: r.share_name || r.symbol || "",
      agent_name: r.agent_name || "",
      model: r.model || "",
      source: r.source || null,
      documents: r.documents || [],
      web_search: r.web_search ?? false,
      web_sources: r.web_sources || [],
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || r.created_at || new Date().toISOString(),
      duration: r.duration ?? null,
      error: r.error || null,
      steps: r.steps || [],
      data_availability: r.data_availability || null,
      price_data: r.price_data || null,
      quantitative_analysis: r.quantitative_analysis || {},
      qualitative_analysis: r.qualitative_analysis || {},
      qualitative_tool_calls: r.qualitative_tool_calls || {},
      quantitative_score: r.quantitative_score ?? null,
      qualitative_score: r.qualitative_score ?? null,
      total_score: r.total_score ?? null,
    };
    const { error } = await supa.from("analysis_runs").upsert(doc, { onConflict: "id" });
    if (error) console.error(`  run ${doc.id} error:`, error.message);
  }
  console.log("Analysis runs done.");

  await mongo.close();
  console.log("Migration complete.");
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
