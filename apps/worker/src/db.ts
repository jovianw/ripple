// Atlas connection for the worker (writer user). Owner: Jovian.
// The worker is the only process that writes design state.
import { MongoClient } from "mongodb";
import type { HarnessConfig, RunResult } from "@board-forge/types";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not set; copy .env.example to .env");

export const COLLECTIONS = [
  "harness_versions",
  "specs",
  "subcircuits",
  "boards",
  "work_queue",
  "runs",
  "lessons",
] as const;

export const client = new MongoClient(uri, { appName: "board-forge-worker" });
export const db = client.db(process.env.MONGODB_DB || "boardforge");

export const col = {
  harness: db.collection<HarnessConfig>("harness_versions"),
  specs: db.collection("specs"),
  subcircuits: db.collection("subcircuits"),
  boards: db.collection("boards"),
  queue: db.collection("work_queue"),
  runs: db.collection<RunResult>("runs"),
  lessons: db.collection("lessons"),
};

export async function connect() {
  await client.connect();
  await db.command({ ping: 1 }); // fails fast if the URI or IP allowlist is wrong
  return db;
}
