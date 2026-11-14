/**
 * Local Postgres (docker compose `postgres`) — user API keys + activity.
 * Supabase stays auth-only (JWT via JWKS); key material never leaves this DB.
 */
import { Pool } from "pg";
import { config } from "../api/config.js";
import { log } from "../api/logger.js";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function getLocalPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
    pool.on("error", (err) => log.error("[localdb]", err.message));
  }
  return pool;
}

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getLocalPool()
      .query(
        `CREATE TABLE IF NOT EXISTS user_settings (
          user_id TEXT PRIMARY KEY,
          voyager_key_encrypted TEXT,
          llm_keys_encrypted JSONB NOT NULL DEFAULT '{}',
          key_version INT,
          defaults_deleted BOOLEAN NOT NULL DEFAULT FALSE,
          deleted_preset_keys JSONB NOT NULL DEFAULT '[]',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS user_activity (
          id BIGSERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          method TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS user_activity_user_id_idx ON user_activity (user_id);
        CREATE INDEX IF NOT EXISTS user_activity_created_at_idx ON user_activity (created_at DESC);`,
      )
      .then(() => undefined)
      .catch((e) => {
        schemaReady = null; // retry on next call
        throw e;
      });
  }
  return schemaReady;
}

export interface UserSettingsRow {
  user_id: string;
  voyager_key_encrypted: string | null;
  llm_keys_encrypted: Record<string, string>;
  key_version: number | null;
  defaults_deleted: boolean | null;
  deleted_preset_keys: string[] | null;
}

export async function getUserSettings(userId: string): Promise<UserSettingsRow | null> {
  await ensureSchema();
  const { rows } = await getLocalPool().query(
    `SELECT user_id, voyager_key_encrypted, llm_keys_encrypted, key_version, defaults_deleted, deleted_preset_keys
     FROM user_settings WHERE user_id = $1`,
    [userId],
  );
  return (rows[0] as UserSettingsRow) ?? null;
}

/** Insert-or-update the given columns for one user. */
export async function upsertUserSettings(userId: string, patch: Partial<Omit<UserSettingsRow, "user_id">>): Promise<void> {
  await ensureSchema();
  const cols: string[] = ["user_id"];
  const vals: unknown[] = [userId];
  const sets: string[] = [];
  let i = 2;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    cols.push(k);
    vals.push(v);
    sets.push(`${k} = EXCLUDED.${k}`);
    i++;
  }
  const sql =
    sets.length > 0
      ? `INSERT INTO user_settings (${cols.join(", ")}) VALUES (${cols.map((_, j) => `$${j + 1}`).join(", ")})
         ON CONFLICT (user_id) DO UPDATE SET ${sets.join(", ")}, updated_at = now()`
      : `INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`;
  await getLocalPool().query(sql, vals);
}

/** Fire-and-forget activity log — never throws into the request path. */
export async function recordActivity(userId: string, method: string, path: string): Promise<void> {
  try {
    await ensureSchema();
    await getLocalPool().query(
      `INSERT INTO user_activity (user_id, method, path) VALUES ($1, $2, $3)`,
      [userId, method, path.slice(0, 500)],
    );
  } catch (e: any) {
    log.warn("[localdb]", `activity log failed: ${e?.message || e}`);
  }
}
