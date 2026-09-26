// Checkpoint loop: spec -> currentConfig -> retrieve memory -> coder ->
// hidden checker -> store RunResult -> repair retry -> credit memory on pass.
//
// Critic integration (Marcos's PR #10) isn't merged yet, so a failed attempt
// retries the coder directly with the raw failure summary as
// `previousFailure` instead of a critic diagnosis. Swap in a critic call
// here once it lands — the repair-budget loop structure won't need to change.
import { randomUUID } from "node:crypto";
import type { BoardMetrics, RunResult } from "@ripple/types";
import { currentConfig } from "../harness/config.js";
import { retrieveLessons, retrieveSubcircuits, addSubcircuit, markLessonsHelped, markSubcircuitsReused } from "../harness/memory.js";
import { col } from "../db.js";
import { runCoder, type CoderResult } from "./coder.js";

export interface CoderLoopOptions {
  /** Reuse a board id to make a rerun overwrite its runs instead of adding new ones. */
  boardId?: string;
  /** Save the passing board to the library and credit retrieved memory. Turn off for ablation runs so held-out solutions never enter memory. Default true. */
  writeMemory?: boolean;
}

export interface CoderLoopResult {
  boardId: string;
  attempts: number;
  runResult: RunResult;
  coderResult: CoderResult;
}

type Checks = {
  runChecks: (json: unknown, expected: unknown, meta?: { board_id?: string; harness_version?: number }) => Promise<RunResult>;
  loadExpected: (id: string) => unknown;
};

/** The hidden checker, loaded by path at runtime so checks/ stays out of the worker's build (same as assembler.ts). */
async function loadChecks(): Promise<Checks> {
  return (await import(new URL("../../../../checks/index.ts", import.meta.url).href)) as Checks;
}

function toBoardMetrics(m: CoderResult["metrics"]): BoardMetrics {
  return {
    area_mm2: m.area_mm2 ?? 0,
    vias: m.vias,
    trace_mm: m.trace_mm,
    // circuit-json has no price field (see metrics.ts) — not derivable yet.
    bom_usd: 0,
  };
}

function failureSummary(failures: RunResult["failures"]): string {
  return failures.map((f) => `${f.check}: ${f.detail}`).join("; ");
}

export async function runCheckpointLoop(
  specId: string,
  specText: string,
  { boardId = randomUUID(), writeMemory = true }: CoderLoopOptions = {},
): Promise<CoderLoopResult> {
  const config = await currentConfig();
  const checks = await loadChecks();
  const expected = checks.loadExpected(specId);

  const [lessons, subcircuits] = await Promise.all([
    retrieveLessons(specText, config.context),
    retrieveSubcircuits(specText, config.context),
  ]);

  let coderResult: CoderResult | undefined;
  let runResult: RunResult | undefined;
  let previousFailure: string | undefined;
  let attempts = 0;
  const maxAttempts = Math.max(1, config.workflow.repair_budget);

  while (attempts < maxAttempts) {
    attempts++;
    coderResult = await runCoder({
      specText,
      config,
      lessons,
      subcircuits,
      previousFailure: config.context.include_last_failure ? previousFailure : undefined,
    });

    const checked = await checks.runChecks(coderResult.circuitJson, expected, {
      board_id: boardId,
      harness_version: config.version,
    });

    runResult = {
      ...checked,
      metrics: toBoardMetrics(coderResult.metrics),
      model: coderResult.model.tier,
      tokens: coderResult.model.totalTokens,
      cost_usd: coderResult.model.costUsd,
    };

    await col.runs.replaceOne({ _id: `${boardId}_${attempts}` }, runResult, { upsert: true });

    if (runResult.passed) break;
    previousFailure = failureSummary(runResult.failures);
  }

  if (!coderResult || !runResult) throw new Error("checkpoint loop produced no result");

  if (runResult.passed && writeMemory) {
    await addSubcircuit({
      name: `board_${specId}`,
      description: specText,
      code: coderResult.source,
      checks_passed: [specId],
    });
    await markLessonsHelped(lessons.map((l) => l._id));
    await markSubcircuitsReused(subcircuits.map((s) => s._id));
  }

  return { boardId, attempts, runResult, coderResult };
}
