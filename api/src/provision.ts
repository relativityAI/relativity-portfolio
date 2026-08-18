import { getDb } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { config } from "./config.js";
import { log } from "./logger.js";

/** Auto-provision a Voyager key for a new user via Voyager's admin API.
 *
 * The Voyager API returns the full key ONLY once at creation time (POST).
 * If creation returns 409 (label already exists), the key cannot be recovered.
 * In that case, we use a unique label to create a fresh key.
 */
export async function provisionVoyagerKey(userId: string): Promise<string | null> {
  if (!config.voyagerAdminKey) {
    log.warn("[provision]", "VOYAGER_ADMIN_KEY not set, skipping auto-provision");
    return null;
  }

  // Try the standard label first; fall back to a unique label on 409
  const labels = [`user:${userId}`, `user:${userId}:v2`, `user:${userId}:${Date.now()}`];

  for (const label of labels) {
    const body = JSON.stringify({
      label,
      name: `User ${userId}`,
      owner: userId,
      scopes: ["data:read"],
      rpm: 60,
      expires_in_days: 30,
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${config.voyagerUrl}/admin/keys`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Voyager-Admin-Key": config.voyagerAdminKey },
          body,
          signal: AbortSignal.timeout(15_000),
        });

        if (res.ok) {
          const { key } = await res.json() as { key: string };
          log.info("[provision]", `Voyager key created for ${userId} with label: ${label}`);
          return key || null;
        }

        // 409 = label already exists; try the next label in the list
        if (res.status === 409) {
          log.warn("[provision]", `Label ${label} already exists, trying next label`);
          break; // break inner loop, go to next label
        }

        // Server error (500/503); retry with backoff
        if (res.status >= 500 && res.status < 600) {
          const waitMs = 1000 * Math.pow(2, attempt);
          log.warn("[provision]", `Voyager ${res.status}, retry ${attempt + 1}/3 after ${waitMs}ms`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        log.error("[provision]", `Voyager key provision failed: ${res.status}`);
        break; // break inner loop for non-retryable errors
      } catch (e: any) {
        const waitMs = 1000 * Math.pow(2, attempt);
        log.warn("[provision]", `Provision error, retry ${attempt + 1}/3 after ${waitMs}ms: ${e.message}`);
        await new Promise(r => setTimeout(r, waitMs));
        if (attempt === 2) break;
      }
    }
  }

  log.error("[provision]", `All provision attempts failed for ${userId}`);
  return null;
}

/** Ensure user_settings row exists; auto-provision Voyager key on first login. */
export async function ensureUserSettings(userId: string): Promise<void> {
  const db = getDb();

  // Check if row exists and already has a key
  const { data: rowData, error: rowError } = await db.from("user_settings")
    .select("user_id, voyager_key_encrypted")
    .eq("user_id", userId)
    .single();

  if (rowError && rowError.code !== 'PGRST116') {
    log.error("[provision]", `DB error checking row: ${rowError.message}`);
  }

  // If row exists AND has a key value, we're done
  if (rowData && rowData.voyager_key_encrypted) {
    log.info("[provision]", `Key already exists for ${userId} (skip)`);
    return;
  }

  log.info("[provision]", rowData ? `Row exists but key is missing (will backfill)` : `No row exists (will create)`);

  // Provision a key (or create a new row if no provision available)
  const voyagerKey = await provisionVoyagerKey(userId);

  if (voyagerKey) {
    try {
      if (rowData) {
        const { error: updateError } = await db.from("user_settings")
          .update({ voyager_key_encrypted: encrypt(voyagerKey) })
          .eq("user_id", userId);

        if (updateError) {
          log.error("[provision]", `DB update error: ${updateError.message}`);
        } else {
          log.info("[provision]", `Backfilled Voyager key for ${userId}`);
        }
      } else {
        const { error: insertError } = await db.from("user_settings")
          .insert({ user_id: userId, voyager_key_encrypted: encrypt(voyagerKey), llm_keys_encrypted: {} });

        if (insertError) {
          log.error("[provision]", `DB insert error: ${insertError.message}`);
        } else {
          log.info("[provision]", `Created user_settings for ${userId} (voyager=provisioned)`);
        }
      }
    } catch (encryptErr: any) {
      log.error("[provision]", `Encryption error: ${encryptErr.message}`);
    }
  } else {
    // Key provisioning failed - create row with null key so UI stops retrying
    if (!rowData) {
      try {
        await db.from("user_settings").insert({ user_id: userId, voyager_key_encrypted: null, llm_keys_encrypted: {} });
        log.info("[provision]", `Created user_settings for ${userId} (voyager=pending)`);
      } catch (insertErr: any) {
        log.error("[provision]", `DB insert error on fallback: ${insertErr.message}`);
      }
    }
  }
}

/** Fetch decrypted user settings (Voyager + LLM keys) from Supabase. */
export async function fetchUserKeys(userId: string): Promise<{ voyagerKey: string; llmKeys: Record<string, string> }> {
  const db = getDb();
  const { data, error } = await db.from("user_settings").select("voyager_key_encrypted, llm_keys_encrypted").eq("user_id", userId).single();
  if (error || !data) return { voyagerKey: "", llmKeys: {} };

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