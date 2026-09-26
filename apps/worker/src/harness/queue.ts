// Durable work queue for long-horizon boards. Owner: Jovian.
// Three rules make "kill it, restart it, nothing lost" true:
//   1. A step finishes atomically: its run, the board update and the queue status commit in one transaction.
//   2. Writes are idempotent: a run's _id is a hash of board, step and attempt, written with upsert.
//   3. Workers resume from the queue: a restarted worker reclaims its own unfinished items at once,
//      and anyone's item whose heartbeat has gone stale is put back as pending.
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import type { RunResult } from "@ripple/types";
import type { Document } from "mongodb";
import { client, col, type StoredWorkItem } from "../db.js";

const HEARTBEAT_MS = 5_000;
const STALE_MS = 30_000;

/** Stable per machine, so a restarted worker recognizes the items it was running when it died. */
export const defaultWorkerId = () => process.env.WORKER_ID || `worker-${hostname()}`;

/** True if `pid` is a running process on this machine (signal 0 only checks). */
export function processAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Whether a running claim is abandoned: claimed on this machine by a process that no longer exists (a restart resumes
 * at once), or claimed elsewhere with a heartbeat older than `staleMs`. A live process on this machine is never
 * robbed, even if two workers share a worker id.
 */
export function abandoned(item: { claimed_by?: string; claimed_pid?: number; heartbeat?: string }, workerId: string, staleMs: number) {
  if (item.claimed_by === workerId) return item.claimed_pid !== process.pid && !processAlive(item.claimed_pid);
  return !item.heartbeat || Date.parse(item.heartbeat) < Date.now() - staleMs;
}

export const runId = (boardId: string, step: number, attempt: number) =>
  createHash("sha1").update(`${boardId}:${step}:${attempt}`).digest("hex");

const itemId = (boardId: string, key: string) => `${boardId}:${key}`;
const now = () => new Date().toISOString();

export interface NewItem {
  key: string;
  title: string;
  depends_on?: string[]; // keys of other items on the same board
  payload?: Record<string, unknown>;
  max_attempts?: number;
}

/** Adds a board's steps (the planner's split). Re-enqueuing the same keys is a no-op, so a crashed planner can rerun. */
export async function enqueue(boardId: string, items: NewItem[]) {
  const keys = new Set(items.map((i) => i.key));
  for (const i of items) {
    for (const d of i.depends_on ?? []) if (!keys.has(d)) throw new Error(`${i.key} depends on unknown item ${d}`);
  }
  await col.queue.bulkWrite(
    items.map((item, step) => {
      const deps = (item.depends_on ?? []).map((d) => itemId(boardId, d));
      return {
        updateOne: {
          filter: { _id: itemId(boardId, item.key) },
          update: {
            $setOnInsert: {
              board_id: boardId,
              key: item.key,
              step,
              title: item.title,
              payload: item.payload,
              status: "pending" as const,
              depends_on: deps,
              waiting_on: deps,
              attempts: 0,
              max_attempts: item.max_attempts ?? 3,
            },
          },
          upsert: true,
        },
      };
    }),
  );
}

/**
 * Puts interrupted items back as pending: this worker's own running items (it restarted),
 * plus anyone's whose heartbeat is older than STALE_MS (that worker died).
 */
export async function recover(workerId = defaultWorkerId(), boardId?: string) {
  const running = await col.queue
    .find({ status: "running", ...(boardId && { board_id: boardId }) }, { projection: { claimed_by: 1, claimed_pid: 1, heartbeat: 1 } })
    .toArray();
  const ids = running.filter((i) => abandoned(i, workerId, STALE_MS)).map((i) => i._id);
  if (!ids.length) return 0;
  const res = await col.queue.updateMany(
    { _id: { $in: ids }, status: "running" },
    { $set: { status: "pending" }, $unset: { claimed_by: "", claimed_pid: "" } },
  );
  return res.modifiedCount;
}

/** Atomically claims the next ready item (pending, no unfinished dependencies), lowest step first. */
export async function claimNext(workerId = defaultWorkerId(), boardId?: string): Promise<StoredWorkItem | null> {
  const t = now();
  return col.queue.findOneAndUpdate(
    { status: "pending", waiting_on: { $size: 0 }, ...(boardId && { board_id: boardId }) },
    { $set: { status: "running", claimed_by: workerId, claimed_pid: process.pid, heartbeat: t, started_at: t }, $inc: { attempts: 1 } },
    { sort: { step: 1 }, returnDocument: "after" },
  );
}

/** Refreshes the heartbeat. Returns false if the claim was lost (the item was recovered and taken by another worker). */
export async function heartbeat(item: StoredWorkItem, workerId = defaultWorkerId()) {
  const res = await col.queue.updateOne(
    { _id: item._id, status: "running", claimed_by: workerId, claimed_pid: process.pid },
    { $set: { heartbeat: now() } },
  );
  return res.matchedCount === 1;
}

class LostClaim extends Error {}

/**
 * Finishes a step in one transaction: upserts its run (idempotent id), stores the board version if given,
 * marks the item done and unblocks its dependents. Throws if this worker no longer holds the claim.
 */
export async function complete(
  item: StoredWorkItem,
  result: { run: RunResult; board?: Document },
  workerId = defaultWorkerId(),
) {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const done = await col.queue.updateOne(
        { _id: item._id, status: "running", claimed_by: workerId, claimed_pid: process.pid },
        { $set: { status: "done", finished_at: now() }, $unset: { claimed_by: "", claimed_pid: "", error: "" } },
        { session },
      );
      if (done.matchedCount !== 1) throw new LostClaim(`lost claim on ${item._id}`);
      const _id = runId(item.board_id, item.step, item.attempts);
      await col.runs.replaceOne({ _id }, result.run, { upsert: true, session });
      if (result.board) await col.boards.insertOne({ ...result.board }, { session });
      await col.queue.updateMany(
        { board_id: item.board_id, waiting_on: item._id },
        { $pull: { waiting_on: item._id } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}

/** Records a failed attempt. Retries (back to pending) until max_attempts, then marks the item failed. */
export async function fail(item: StoredWorkItem, error: string, run?: RunResult, workerId = defaultWorkerId()) {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const retry = item.attempts < item.max_attempts;
      const res = await col.queue.updateOne(
        { _id: item._id, status: "running", claimed_by: workerId, claimed_pid: process.pid },
        { $set: { status: retry ? "pending" : "failed", error, finished_at: now() }, $unset: { claimed_by: "", claimed_pid: "" } },
        { session },
      );
      if (res.matchedCount !== 1) throw new LostClaim(`lost claim on ${item._id}`);
      if (run) {
        const _id = runId(item.board_id, item.step, item.attempts);
        await col.runs.replaceOne({ _id }, run, { upsert: true, session });
      }
    });
  } finally {
    await session.endSession();
  }
}

/** Counts by status, plus the items in each state, for the UI and the demo. */
export async function progress(boardId: string) {
  const items = await col.queue.find({ board_id: boardId }, { sort: { step: 1 } }).toArray();
  const counts = { pending: 0, running: 0, done: 0, failed: 0 };
  for (const i of items) counts[i.status]++;
  return { ...counts, total: items.length, items };
}

export type Handler = (item: StoredWorkItem) => Promise<{ run: RunResult; board?: Document }>;

/**
 * Runs a board's queue to the end with one worker: recover, then claim → handle (with heartbeats) → complete.
 * Kill it at any point and call it again; it picks up where it stopped.
 */
export async function runQueue(
  boardId: string,
  handler: Handler,
  opts: { workerId?: string; log?: (msg: string) => void } = {},
) {
  const workerId = opts.workerId ?? defaultWorkerId();
  const log = opts.log ?? (() => {});
  const recovered = await recover(workerId, boardId);
  if (recovered) log(`recovered ${recovered} interrupted item(s)`);

  for (;;) {
    const item = await claimNext(workerId, boardId);
    if (!item) {
      const p = await progress(boardId);
      // Nothing running and nothing claimable: finished, or the rest is blocked behind a failed item.
      if (p.running === 0) return p;
      await sleep(1_000); // another worker is still running something this board needs
      await recover(workerId, boardId);
      continue;
    }
    log(`claimed ${item.key} (attempt ${item.attempts}/${item.max_attempts})`);
    const beat = setInterval(() => void heartbeat(item, workerId).catch(() => {}), HEARTBEAT_MS);
    try {
      const result = await handler(item);
      await complete(item, result, workerId);
      log(`done ${item.key}`);
    } catch (err) {
      try {
        if (err instanceof LostClaim) throw err;
        const message = err instanceof Error ? err.message : String(err);
        await fail(item, message, undefined, workerId);
        log(`failed ${item.key}: ${message}`);
      } catch (e) {
        if (!(e instanceof LostClaim)) throw e;
        log(e.message); // another worker recovered and took this item; leave it to them
      }
    } finally {
      clearInterval(beat);
    }
  }
}
