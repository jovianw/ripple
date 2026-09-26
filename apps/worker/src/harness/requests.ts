// Spec requests from the web app. Owner: Jovian.
// The web app writes only to `spec_requests` (its `ripple_requester` user has readWrite on that collection alone). This worker side
// claims requests atomically, runs them, and writes status back, so "one writer" still holds for all design state.
// New requests arrive through an Atlas change stream; a slow poll backs it up in case the stream drops.
import { setTimeout as sleep } from "node:timers/promises";
import { col, type SpecRequest } from "../db.js";
import { hostname } from "node:os";
import { defaultWorkerId, releaseAbandoned } from "./queue.js";

const HEARTBEAT_MS = 5_000;
const STALE_MS = 60_000;
const POLL_MS = 10_000;
const now = () => new Date().toISOString();

export type RequestHandler = (
  req: SpecRequest & { _id: NonNullable<SpecRequest["_id"]> },
  setBoard: (boardId: string, harnessVersion: number) => Promise<void>,
) => Promise<{ passed: boolean; attempts?: number }>;

/** Requests this worker was running when it died, and anyone's whose heartbeat went stale, go back to queued. */
export async function recoverRequests(workerId = defaultWorkerId()) {
  void workerId; // ownership is decided by host + pid (see queue.ts abandoned)
  const running = await col.requests.find({ status: "running" }, { projection: { claimed_host: 1, claimed_pid: 1, heartbeat: 1 } }).toArray();
  return releaseAbandoned(col.requests as never, running.map((r) => ({ ...r, _id: r._id! })), STALE_MS, "queued");
}

/** Atomically claims the oldest queued request. */
export function claimRequest(workerId = defaultWorkerId()) {
  const t = now();
  return col.requests.findOneAndUpdate(
    { status: "queued" },
    { $set: { status: "running", claimed_by: workerId, claimed_pid: process.pid, claimed_host: hostname(), started_at: t, heartbeat: t } },
    { sort: { created_at: 1 }, returnDocument: "after" },
  );
}

async function runOne(req: SpecRequest & { _id: NonNullable<SpecRequest["_id"]> }, handler: RequestHandler, workerId: string) {
  const mine = { _id: req._id, status: "running" as const, claimed_by: workerId, claimed_pid: process.pid };
  const beat = setInterval(() => void col.requests.updateOne(mine, { $set: { heartbeat: now() } }).catch(() => {}), HEARTBEAT_MS);
  try {
    const setBoard = async (board_id: string, harness_version: number) => {
      await col.requests.updateOne(mine, { $set: { board_id, harness_version } });
    };
    const { passed, attempts } = await handler(req, setBoard);
    await col.requests.updateOne(mine, { $set: { status: "done", passed, attempts, finished_at: now() }, $unset: { claimed_by: "", claimed_pid: "", claimed_host: "" } });
    return passed;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await col.requests.updateOne(mine, { $set: { status: "failed", error: error.slice(0, 500), finished_at: now() }, $unset: { claimed_by: "", claimed_pid: "", claimed_host: "" } });
    throw err;
  } finally {
    clearInterval(beat);
  }
}

/**
 * Serves spec requests until `signal` aborts: recovers interrupted ones, drains the queue one at a time (model budget),
 * then waits on a change stream for new inserts (with a slow poll as backup).
 */
export async function serveRequests(handler: RequestHandler, opts: { workerId?: string; log?: (m: string) => void; signal?: AbortSignal } = {}) {
  const workerId = opts.workerId ?? defaultWorkerId();
  const log = opts.log ?? (() => {});
  const recovered = await recoverRequests(workerId);
  if (recovered) log(`recovered ${recovered} interrupted request(s)`);

  let wake: () => void = () => {};
  const stream = col.requests.watch([{ $match: { operationType: "insert" } }]);
  stream.on("change", () => wake());
  stream.on("error", (e) => log(`change stream error (falling back to polling): ${e.message}`));
  opts.signal?.addEventListener("abort", () => wake());

  try {
    while (!opts.signal?.aborted) {
      const req = await claimRequest(workerId);
      if (!req) {
        await Promise.race([new Promise<void>((r) => (wake = r)), sleep(POLL_MS)]);
        await recoverRequests(workerId);
        continue;
      }
      const what = req.spec_id ?? `"${(req.text ?? "").slice(0, 60)}"`;
      log(`request ${req._id}: ${what}`);
      try {
        const passed = await runOne(req as SpecRequest & { _id: NonNullable<SpecRequest["_id"]> }, handler, workerId);
        log(`request ${req._id}: ${passed ? "passed" : "done, did not pass"}`);
      } catch (err) {
        log(`request ${req._id}: failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await stream.close();
  }
}
