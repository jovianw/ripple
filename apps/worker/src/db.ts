// Atlas connection for the worker (writer user). Owner: Jovian.
// The worker is the only process that writes design state.
import { MongoClient } from "mongodb";
import type { HarnessConfig, Lesson, RunResult, Subcircuit, WorkItem } from "@ripple/types";

/** A work-queue step. `waiting_on` shrinks as dependencies finish; an item is ready when it's empty. */
export type StoredWorkItem = WorkItem & {
  key: string; // unique within the board, e.g. "usb-power"
  step: number; // order to prefer among ready items
  title: string;
  payload?: Record<string, unknown>; // whatever the handler needs (subcircuit spec text, etc.)
  waiting_on: string[];
  attempts: number;
  max_attempts: number;
  claimed_by?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
};

// Memory documents carry a few fields beyond the shared draft shapes.
export type StoredLesson = Lesson & { active: boolean; created_at: Date };
export type StoredSubcircuit = Subcircuit & { description: string; created_at: Date };
export type StoredRun = RunResult & {
  _id?: string;
  embedding?: number[];
  failure_summary?: string;
  /** Ids of lessons/subcircuits retrieved into the coder's context for this attempt (the "why?" view). */
  lessons_used?: string[];
  subcircuits_used?: string[];
};
/** A config version plus what the gate recorded when it decided. */
export type StoredConfig = HarnessConfig & { gate_note?: string; decided_at?: string };
/** One row of `npm run ablation`'s table (DESIGN.md §7), so Jack can show it instead of fixture data. */
export interface StoredAblationRow {
  setup: string;
  harness_version: number;
  checks_passed: number;
  total: number;
  avg_attempts: number;
  avg_cost_usd: number;
  ts: string;
}

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
  "ablations",
] as const;

export const client = new MongoClient(uri, { appName: "ripple-worker" });
export const db = client.db(process.env.MONGODB_DB || "ripple");

export const col = {
  harness: db.collection<StoredConfig>("harness_versions"),
  specs: db.collection("specs"),
  subcircuits: db.collection<StoredSubcircuit>("subcircuits"),
  boards: db.collection("boards"),
  queue: db.collection<StoredWorkItem>("work_queue"),
  runs: db.collection<StoredRun>("runs"),
  lessons: db.collection<StoredLesson>("lessons"),
  ablations: db.collection<StoredAblationRow>("ablations"),
};

export async function connect() {
  await client.connect();
  await db.command({ ping: 1 }); // fails fast if the URI or IP allowlist is wrong
  return db;
}
