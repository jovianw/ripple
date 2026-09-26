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
  claimed_pid?: number; // process on `claimed_by`'s machine; a dead pid means the claim is abandoned
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
/**
 * A spec submitted from the web app (inserted by the `ripple_requester` user, readWrite on this collection only).
 * The worker (`npm run worker`) claims it and writes everything else.
 */
export type SpecRequest = {
  _id?: import("mongodb").ObjectId;
  spec_id?: string; // a spec from specs/specs.json or "finale"
  text?: string; // free text (needs Arjun's ad-hoc runBoard)
  status: "queued" | "running" | "done" | "failed";
  created_at: Date | string;
  claimed_by?: string;
  claimed_pid?: number; // process on `claimed_by`'s machine; a dead pid means the claim is abandoned
  started_at?: string;
  heartbeat?: string;
  finished_at?: string;
  board_id?: string; // runs/boards for this request use this board_id
  harness_version?: number;
  passed?: boolean;
  attempts?: number;
  error?: string;
};

/** A config version plus what the gate recorded when it decided. */
export type StoredConfig = HarnessConfig & {
  gate_note?: string;
  decided_at?: string;
  /** Set while a gate is evaluating this pending version, so two concurrent `evolve` runs don't score it twice. */
  claimed_by?: string;
  claimed_at?: string;
  /** The one child version the gate kept on top of this one; claimed atomically so two sibling proposals can't both be kept. */
  succeeded_by?: number;
};
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
  "spec_requests",
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
  requests: db.collection<SpecRequest>("spec_requests"),
};

export async function connect() {
  await client.connect();
  await db.command({ ping: 1 }); // fails fast if the URI or IP allowlist is wrong
  return db;
}
