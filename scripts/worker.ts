// Long-running worker for spec requests from the web app (see apps/worker/src/harness/requests.ts).
//   npm run worker
// A request `{ spec_id }` runs that spec under the current config: training/held-out specs through Arjun's runBoard,
// "finale" through Marcos's planned-board pipeline (work queue, kill-and-resume). Free-text requests need Arjun's
// ad-hoc runBoard and fail with a clear message until it lands. One request at a time (model budget).
// Ctrl+C stops it; restarting picks up interrupted requests.
import { randomUUID } from "node:crypto";
import specs from "../specs/specs.json" with { type: "json" };
import finaleSpec from "../specs/finale.json" with { type: "json" };
import type { HarnessConfig } from "@ripple/types";
import { client, connect } from "../apps/worker/src/db.ts";
import { currentConfig } from "../apps/worker/src/harness/config.ts";
import { serveRequests } from "../apps/worker/src/harness/requests.ts";
import { defaultWorkerId } from "../apps/worker/src/harness/queue.ts";

// Dynamic imports: scripts/tsconfig.json can't statically walk tscircuit (same as scripts/ablation.ts).
const load = (p: string) => import(new URL(p, import.meta.url).href);
const { runBoard } = (await load("../apps/worker/src/agents/coder-loop.ts")) as {
  runBoard: (specId: string, config: HarnessConfig, opts: { boardId: string; writeMemory: boolean }) =>
    Promise<{ boardId: string; attempts: number; runResult: { passed: boolean } }>;
};
const { runPlannedBoard } = (await load("../apps/worker/src/pipeline/planned-board.ts")) as {
  runPlannedBoard: (boardId: string, spec: { _id: string; text: string }, config: HarnessConfig, deps: unknown) =>
    Promise<{ final: { passed?: boolean } | null; progress: { done: number; total: number } }>;
};
const { createComplete } = (await load("../apps/worker/src/tools/router.ts")) as {
  createComplete: (role: "planner", config: HarnessConfig) => unknown;
};
const { runCoder } = (await load("../apps/worker/src/agents/coder.ts")) as { runCoder: (input: unknown) => Promise<unknown> };

const SPECS = specs as { _id: string; split: string; text: string }[];
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

await connect();
const stop = new AbortController();
process.on("SIGINT", () => {
  log("stopping after the current request (Ctrl+C again to kill; it resumes on restart)");
  if (stop.signal.aborted) process.exit(130);
  stop.abort();
});

log(`worker ${defaultWorkerId()} waiting for spec requests`);
await serveRequests(
  async (req, setBoard) => {
    const config = await currentConfig();
    if (!req.spec_id) throw new Error("free-text specs aren't supported yet (waiting on ad-hoc runBoard); send a spec_id");

    if (req.spec_id === finaleSpec._id) {
      const boardId = `finale-req-${String(req._id).slice(-6)}`;
      await setBoard(boardId, config.version);
      const deps = { planner: { complete: createComplete("planner", config) }, coder: runCoder, log };
      const { final, progress } = await runPlannedBoard(boardId, finaleSpec, config, deps);
      return { passed: !!final?.passed, attempts: progress.done };
    }

    const spec = SPECS.find((s) => s._id === req.spec_id);
    if (!spec) throw new Error(`unknown spec_id ${req.spec_id}; use one from specs/specs.json or "finale"`);
    // A resumed request keeps its board id, so the rerun overwrites the interrupted attempt's runs (upserted by id).
    const boardId = req.board_id ?? `req-${String(req._id).slice(-6)}-${randomUUID().slice(0, 8)}`;
    await setBoard(boardId, config.version);
    // Held-out solutions never enter the library (they'd leak into the ablation).
    const r = await runBoard(spec._id, config, { boardId, writeMemory: spec.split === "train" });
    return { passed: r.runResult.passed, attempts: r.attempts };
  },
  { log, signal: stop.signal },
);
await client.close();
