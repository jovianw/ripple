// Long-running worker for spec requests from the web app (see apps/worker/src/harness/requests.ts).
//   npm run worker
// A request `{ spec_id }` runs that spec under the current config: training/held-out specs through Arjun's runBoard,
// "finale" through Marcos's planned-board pipeline (work queue, kill-and-resume). Free text `{ text }` runs through the
// same loop with Marcos's generic checks (checks/generic.ts, built from the board and the text) and never writes
// the memory library. Runs WORKER_CONCURRENCY requests at once (default 3, so several users' prompts progress in
// parallel); set it to 1 to go back to one at a time.
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
const { runBoard, specCacheKey } = (await load("../apps/worker/src/agents/coder-loop.ts")) as {
  runBoard: (
    specId: string,
    config: HarnessConfig,
    opts: {
      boardId: string;
      writeMemory: boolean;
      spec?: { _id: string; text: string; split: "held_out" };
      expectedFor?: (cj: unknown) => unknown;
      cacheKey?: string;
    },
  ) =>
    Promise<{ boardId: string; attempts: number; runResult: { passed: boolean } }>;
  specCacheKey: (text: string) => string;
};
const { runPlannedBoard } = (await load("../apps/worker/src/pipeline/planned-board.ts")) as {
  runPlannedBoard: (boardId: string, spec: { _id: string; text: string }, config: HarnessConfig, deps: unknown) =>
    Promise<{ final: { passed?: boolean } | null; progress: { done: number; total: number } }>;
};
// Marcos's live deps for planned boards: planner via the router, coder, lessons per subcircuit, critic repair rounds.
// Same as `npm run finale`, so a finale started from the web behaves exactly like the CLI.
const { liveDeps } = (await load("../apps/worker/src/pipeline/live-deps.ts")) as {
  liveDeps: (spec: { _id: string; text: string }, boardId: string, config: HarnessConfig, log?: (m: string) => void) => unknown;
};
const checks = (await load("../checks/index.ts")) as { genericExpected?: (circuitJson: unknown, specText?: string) => unknown };
// Free text has no hidden-check file: Marcos's generic checks are built from the board and the spec text
// (header labels come from the text). DRC only if checks/ doesn't export them.
const genericExpected = (circuitJson: unknown, text: string) => checks.genericExpected?.(circuitJson, text) ?? {};

const SPECS = specs as { _id: string; split: string; text: string }[];
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 3);

await connect();
const stop = new AbortController();
process.on("SIGINT", () => {
  log("stopping after in-flight requests finish (Ctrl+C again to kill; it resumes on restart)");
  if (stop.signal.aborted) process.exit(130);
  stop.abort();
});

log(`worker ${defaultWorkerId()} waiting for spec requests (concurrency ${concurrency})`);
await serveRequests(
  async (req, setBoard) => {
    const config = await currentConfig();
    if (!req.spec_id) {
      const text = (req.text ?? "").trim();
      if (!text) throw new Error("request has neither spec_id nor text");
      const specId = `adhoc-${String(req._id).slice(-6)}`;
      const boardId = req.board_id ?? `req-${String(req._id).slice(-6)}-${randomUUID().slice(0, 8)}`;
      await setBoard(boardId, config.version);
      const r = await runBoard(specId, config, {
        boardId,
        writeMemory: false, // ungraded by hidden checks: never enters the subcircuit library
        // "held_out" (not "train"): writeMemory only gates a *passing* board's subcircuit; the critic's own
        // gate on a *failed* attempt only checks spec.split, and would otherwise let a judge's free-text
        // prompt write lessons into the shared library.
        spec: { _id: specId, text, split: "held_out" },
        expectedFor: (circuitJson) => genericExpected(circuitJson, text),
        // Same wording, already verified under this harness version: reuse it instead of designing again.
        cacheKey: specCacheKey(text),
      });
      return { passed: r.runResult.passed, attempts: r.attempts };
    }

    if (req.spec_id === finaleSpec._id) {
      const boardId = `finale-req-${String(req._id).slice(-6)}`;
      await setBoard(boardId, config.version);
      const { final, progress } = await runPlannedBoard(boardId, finaleSpec, config, liveDeps(finaleSpec, boardId, config, log));
      return { passed: !!final?.passed, attempts: progress.done };
    }

    const spec = SPECS.find((s) => s._id === req.spec_id);
    if (!spec) throw new Error(`unknown spec_id ${req.spec_id}; use one from specs/specs.json or "finale"`);
    // A resumed request keeps its board id, so the rerun overwrites the interrupted attempt's runs (upserted by id).
    const boardId = req.board_id ?? `req-${String(req._id).slice(-6)}-${randomUUID().slice(0, 8)}`;
    await setBoard(boardId, config.version);
    // Held-out solutions never enter the library (they'd leak into the ablation).
    const r = await runBoard(spec._id, config, { boardId, writeMemory: spec.split === "train", cacheKey: spec._id });
    return { passed: r.runResult.passed, attempts: r.attempts };
  },
  { log, signal: stop.signal, concurrency },
);
await client.close();
