import { getDb } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { config } from "./config.js";
import { log } from "./logger.js";

/** Auto-provision a Voyager key for a new user via Voyager's admin API. */
async function provisionVoyagerKey(userId: string): Promise<string | null> {
  if (!config.voyagerAdminKey) {
    log.warn("[provision]", "VOYAGER_ADMIN_KEY not set, skipping auto-provision");
    return null;
  }
  try {
    const res = await fetch(`${config.voyagerUrl}/admin/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Voyager-Admin-Key": config.voyagerAdminKey },
      body: JSON.stringify({
        label: `user:${userId}`,
        name: `User ${userId}`,
        owner: userId,
        scopes: ["data:read"],
        rpm: 60,
        expires_in_days: 30,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      log.error("[provision]", `Voyager key provision failed: ${res.status}`);
      return null;
    }
    const { key } = await res.json() as { key: string };
    return key || null;
  } catch (e: any) {
    log.error("[provision]", `Voyager key provision error: ${e.message}`);
    return null;
  }
}

/** Ensure user_settings row exists; auto-provision Voyager key on first login. */
export async function ensureUserSettings(userId: string): Promise<void> {
  const db = getDb();
  const { data } = await db.from("user_settings").select("user_id, voyager_key_encrypted").eq("user_id", userId).single();
  if (data && data.voyager_key_encrypted) return;
  const voyagerKey = await provisionVoyagerKey(userId);
  if (voyagerKey) {
    if (data) {
      await db.from("user_settings").update({ voyager_key_encrypted: encrypt(voyagerKey) }).eq("user_id", userId);
      log.info("[provision]", `Backfilled Voyager key for ${userId}`);
    } else {
      await db.from("user_settings").insert({ user_id: userId, voyager_key_encrypted: encrypt(voyagerKey), llm_keys_encrypted: {} });
      log.info("[provision]", `Created user_settings for ${userId} (voyager=provisioned)`);
    }
  } else if (!data) {
    await db.from("user_settings").insert({ user_id: userId, voyager_key_encrypted: null, llm_keys_encrypted: {} });
    log.info("[provision]", `Created user_settings for ${userId} (voyager=pending)`);
  }
}

/** Fetch decrypted user settings (Voyager + LLM keys) from Supabase. */
export async function fetchUserKeys(userId: string): Promise<{ voyagerKey: string; llmKeys: Record<string, string> }> {
  const db = getDb();
  const { data } = await db.from("user_settings").select("voyager_key_encrypted, llm_keys_encrypted").eq("user_id", userId).single();
  if (!data) return { voyagerKey: "", llmKeys: {} };
  let voyagerKey = "";
  try {
    voyagerKey = data.voyager_key_encrypted ? decrypt(data.voyager_key_encrypted) : "";
  } catch { voyagerKey = ""; }
  let llmKeys: Record<string, string> = {};
  if (data.llm_keys_encrypted && typeof data.llm_keys_encrypted === "object") {
    for (const [k, v] of Object.entries(data.llm_keys_encrypted as Record<string, string>)) {
      try { llmKeys[k] = decrypt(v); } catch { llmKeys[k] = ""; }
    }
  }
  return { voyagerKey, llmKeys };
}
