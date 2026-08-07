import { MongoClient, ObjectId } from "mongodb";
import { config } from "./config.js";

let client: MongoClient | null = null;
let connecting: Promise<MongoClient> | null = null;

export async function connectDb(): Promise<MongoClient> {
  if (client) return client;
  if (!connecting) {
    connecting = (async () => {
      const c = new MongoClient(config.mongodbUrl, { serverSelectionTimeoutMS: 4000 });
      await c.connect();
      client = c;
      return c;
    })();
  }
  return connecting;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    connecting = null;
  }
}

export function db(): import("mongodb").Db {
  if (!client) throw new Error("database not connected");
  return client.db(config.mongodbDb);
}

export function toPlain<T extends { _id?: unknown }>(doc: T): T & { _id: string; id: string } {
  if (!doc) return doc as any;
  const { _id, ...rest } = doc as any;
  const id = _id instanceof ObjectId ? _id.toHexString() : String(_id ?? "");
  return { ...rest, _id: id, id };
}

export function newId(): string {
  return new ObjectId().toHexString();
}
