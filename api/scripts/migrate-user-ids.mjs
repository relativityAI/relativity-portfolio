/**
 * One-time migration: assign existing agents / analysis_runs to a user.
 *
 * Existing docs created before auth was added have no user_id, so they are
 * invisible to every user. Run this once, after creating your first user:
 *
 *   node scripts/migrate-user-ids.mjs <supabase-user-id>
 *
 * where <supabase-user-id> is the auth user id (payload.sub) of the account
 * that should own the legacy data. It also creates the user_id index used by
 * the scoped queries.
 */
import "dotenv/config";
import { MongoClient } from "mongodb";

const MONGODB_URL = process.env.MONGODB_URL || "mongodb://root:example@localhost:27017/";
const MONGODB_DB = process.env.MONGODB_DB_NAME || "relativity";
const USER_ID = process.argv[2];

if (!USER_ID) {
  console.error("Usage: node scripts/migrate-user-ids.mjs <supabase-user-id>");
  process.exit(1);
}

const client = new MongoClient(MONGODB_URL, { serverSelectionTimeoutMS: 5000 });

try {
  await client.connect();
  const db = client.db(MONGODB_DB);

  for (const collection of ["agents", "analysis_runs"]) {
    const res = await db
      .collection(collection)
      .updateMany({ user_id: { $exists: false } }, { $set: { user_id: USER_ID } });
    await db.collection(collection).createIndex({ user_id: 1 });
    console.log(`${collection}: assigned ${res.modifiedCount} doc(s), index created`);
  }
  console.log("Migration complete.");
} catch (e) {
  console.error("Migration failed:", e);
  process.exit(1);
} finally {
  await client.close();
}
