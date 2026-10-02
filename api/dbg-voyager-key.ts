/**
 * dbg-voyager-key — inspect / rotate the user's stored Voyager key.
 * Usage: npx tsx dbg-voyager-key.ts [--set <new-key>]
 */
import { getDb } from "./src/db.js";
import { encrypt, decrypt } from "./src/crypto.js";

const db = getDb();
const mode = process.argv[2];
const newKey = process.argv[3];

const { data, error } = await db.from("user_settings").select("user_id, voyager_key_encrypted, key_version, updated_at");
if (error) {
  console.error("select failed:", error.message);
  process.exit(1);
}
if (!data?.length) {
  console.log("no user_settings rows");
  process.exit(0);
}
for (const row of data) {
  let plain = "(none)";
  try { plain = row.voyager_key_encrypted ? decrypt(row.voyager_key_encrypted) : "(null)"; } catch (e: any) { plain = `(decrypt failed: ${e.message})`; }
  const masked = plain && !plain.startsWith("(") ? plain.slice(0, 4) + "…" + plain.slice(-4) : plain;
  console.log(`${row.user_id}  v${row.key_version ?? 1}  key=${masked}  updated=${row.updated_at}`);
  if (mode === "--set" && newKey) {
    const { error: upErr } = await db
      .from("user_settings")
      .update({ voyager_key_encrypted: encrypt(newKey), key_version: 2, updated_at: new Date().toISOString() })
      .eq("user_id", row.user_id);
    if (upErr) console.error(`  update failed for ${row.user_id}:`, upErr.message);
    else {
      const { data: after } = await db.from("user_settings").select("voyager_key_encrypted").eq("user_id", row.user_id).single();
      let check = "";
      try { check = decrypt(after.voyager_key_encrypted); } catch {}
      console.log(`  updated → stored roundtrip ${check === newKey ? "OK" : "MISMATCH"} (${check.slice(0, 4)}…)`);
    }
  }
}
