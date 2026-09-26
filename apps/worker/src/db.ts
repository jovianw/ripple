// Atlas connection for the worker (writer user). Owner: Jovian.
// The worker is the only process that writes design state.
import { MongoClient } from "mongodb";
import type { HarnessConfig, Lesson, RunResult, Subcircuit } from "@ripple/types";

// Memory documents carry a few fields beyond the shared draft shapes.
export type StoredLesson = Lesson & { active: boolean; created_at: Date };
export type StoredSubcircuit = Subcircuit & { description: string; created_at: Date };
export type StoredRun = RunResult & { _id?: string; embedding?: number[]; failure_summary?: string };

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

export const client = new MongoClient(uri, { appName: "ripple-worker" });
export const db = client.db(process.env.MONGODB_DB || "ripple");

export const col = {
  harness: db.collection<HarnessConfig>("harness_versions"),
  specs: db.collection("specs"),
  subcircuits: db.collection<StoredSubcircuit>("subcircuits"),
  boards: db.collection("boards"),
  queue: db.collection("work_queue"),
  runs: db.collection<StoredRun>("runs"),
  lessons: db.collection<StoredLesson>("lessons"),
};

export async function connect() {
  await client.connect();
  await db.command({ ping: 1 }); // fails fast if the URI or IP allowlist is wrong
  return db;
}
