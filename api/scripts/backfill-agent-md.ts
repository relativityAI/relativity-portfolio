/**
 * Backfill md_config for agent rows that predate markdown storage (migration 008).
 * One-off migration tool:
 *
 *   npx tsx scripts/backfill-agent-md.ts
 *
 * Safe to re-run: rows with non-empty md_config are skipped. The JSONB columns
 * are left in place as the read-cache until migration 009 drops them.
 */

import { getDb } from "../src/db.js";
import { agentFromRow, type AgentRow } from "../src/agentstore.js";

const db = getDb();

const { data, error } = await db.from("agents").select("*").limit(100000);
if (error) throw new Error(`failed to fetch agents: ${error.message}`);

const rows = (data || []) as AgentRow[];
const candidates = rows.filter((r) => !r.md_config?.trim());
let done = 0;
let failed = 0;

for (const row of candidates) {
  const { config, md, issues } = agentFromRow(row);
  if (!config) {
    failed++;
    console.error(`skip ${row.id} (${row.name}): ${issues.map((i) => i.message).join("; ")}`);
    continue;
  }
  const { error: upErr } = await db.from("agents").update({ md_config: md }).eq("id", row.id);
  if (upErr) {
    failed++;
    console.error(`update failed for ${row.id} (${row.name}): ${upErr.message}`);
    continue;
  }
  done++;
}

console.log(`backfill complete: ${done} backfilled, ${failed} failed, ${rows.length - candidates.length} already had md_config`);
process.exit(failed ? 1 : 0);