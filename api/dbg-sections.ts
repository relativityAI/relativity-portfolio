import "dotenv/config";
import { getDb } from "./src/db.js";
import { decrypt } from "./src/crypto.js";
const db = getDb();
const { data } = await db.from("user_settings").select("voyager_key_encrypted").eq("user_id", "1c2085ee-9af7-4dc7-8139-1646cad35606").single();
const key = decrypt(data!.voyager_key_encrypted);
for (const sections of [["volume_profile"], ["mtf_signal_matrix"]]) {
  const url = `${process.env.VOYAGER_URL}/technicals?symbol=GLAND&source=nse&sections=${sections.join(",")}`;
  const res = await fetch(url, { headers: { "X-API-Key": key }, signal: AbortSignal.timeout(20000) });
  const j: any = await res.json();
  const sec = j.sections?.[sections[0]];
  console.log(`sections=${sections.join(",")}: http=${res.status} status=${sec?.status} keys=${sec?.data ? Object.keys(sec.data).join(",") : "null"}`);
  if (sections[0] === "volume_profile" && sec?.data?.bins) console.log(`  bins=${sec.data.bins.length} first=${JSON.stringify(sec.data.bins[0])}`);
  if (sections[0] === "mtf_signal_matrix" && Array.isArray(sec?.data)) console.log(`  rows=${sec.data.length} first=${JSON.stringify(sec.data[0]).slice(0, 200)}`);
}
