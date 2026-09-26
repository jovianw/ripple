// Board runner: spec -> retrieve memory -> coder -> hidden checker -> store
// RunResult -> on failure, critic diagnosis feeds the retry -> credit memory
// on pass. runBoard does one spec; runBatch is the only batch runner — the
// config gate and the ablation both call it with whatever config they're
// scoring, not necessarily the current kept one.
import { randomUUID } from "node:crypto";
import type { BoardMetrics, HarnessConfig, RunResult, Spec } from "@ripple/types";
import { retrieveLessons, retrieveSubcircuits, addLesson, addSubcircuit, markLessonsHelped, markSubcircuitsReused } from "../harness/memory.js";
import { col } from "../db.js";
import { createComplete } from "../tools/router.js";
import { runCoder, type CoderResult } from "./coder.js";
import { runCritic, type CriticResult } from "./critic/index.js";
import specs from "../../../../specs/specs.json" with { type: "json" };
import finale from "../../../../specs/finale.json" with { type: "json" };

// finale.json has no split; it's the demo board, not part of the train/held-out ablation set.
const ALL_SPECS: Spec[] = [...(specs as Spec[]), { ...finale, split: "train" }];

export function findSpec(specId: string): Spec {
  const spec = ALL_SPECS.find((s) => s._id === specId);
  if (!spec) throw new Error(`unknown spec id "${specId}"`);
  return spec;
}

export interface RunBoardOptions {
  /** Reuse a board id to make a rerun overwrite its runs instead of adding new ones. */
  boardId?: string;
  /** Save the passing board to the library and credit retrieved memory. Turn off for ablation runs so held-out solutions never enter memory. Default true. */
  writeMemory?: boolean;
}

export interface RunBoardResult {
  specId: string;
  boardId: string;
  attempts: number;
  runResult: RunResult;
  coderResult: CoderResult;
  criticResults: CriticResult[];
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

export async function runBoard(specId: string, config: HarnessConfig, opts: RunBoardOptions = {}): Promise<RunBoardResult> {
  const { boardId = randomUUID(), writeMemory = true } = opts;
  const spec = findSpec(specId);
  const checks = await loadChecks();
  const expected = checks.loadExpected(specId);
  const completeCritic = createComplete("critic", config);

  const [lessons, subcircuits] = await Promise.all([
    retrieveLessons(spec.text, config.context),
    retrieveSubcircuits(spec.text, config.context),
  ]);

  let coderResult: CoderResult | undefined;
  let runResult: RunResult | undefined;
  let previousFailure: string | undefined;
  let previousFailures: RunResult["failures"] | undefined;
  const criticResults: CriticResult[] = [];
  let attempts = 0;
  const maxAttempts = Math.max(1, config.workflow.repair_budget);

  while (attempts < maxAttempts) {
    attempts++;
    coderResult = await runCoder({
      specText: spec.text,
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

    // Critic diagnoses the failure and proposes the smallest fix; that fix
    // (not just the raw failure list) becomes the next attempt's context.
    // Lessons it writes are stored immediately (memory.addLesson), so they
    // can help other boards even if this one keeps failing.
    if (attempts < maxAttempts) {
      const critic = await runCritic(
        {
          spec: { _id: spec._id, text: spec.text, split: spec.split },
          code: coderResult.source,
          result: runResult,
          previousFailures,
          lessons: lessons.map((l) => ({ _id: l._id, pattern: l.pattern, fix: l.fix })),
          rules: config.rules,
          attempt: attempts,
          repairBudget: maxAttempts,
        },
        { complete: completeCritic, addLesson },
      );
      criticResults.push(critic);
      previousFailure = [...critic.diagnosis.map((d) => `${d.check}: ${d.cause}`), ...critic.fix].join("\n");
    }

    previousFailures = runResult.failures;
  }

  if (!coderResult || !runResult) throw new Error(`runBoard(${specId}) produced no result`);

  if (runResult.passed && writeMemory) {
    await addSubcircuit({
      name: `board_${specId}`,
      description: spec.text,
      code: coderResult.source,
      checks_passed: [specId],
    });
    await markLessonsHelped(lessons.map((l) => l._id));
    await markSubcircuitsReused(subcircuits.map((s) => s._id));
  }

  return { specId, boardId, attempts, runResult, coderResult, criticResults };
}

export interface RunBatchOptions extends RunBoardOptions {
  /** Boards to run at once. Keep modest — the team shares one OpenRouter budget and one Atlas cluster. */
  concurrency?: number;
}

/** Runs every spec in `specIds` under one config. The only batch runner — the config gate and the ablation both call this. */
export async function runBatch(specIds: string[], config: HarnessConfig, opts: RunBatchOptions = {}): Promise<RunBoardResult[]> {
  const { concurrency = 3, ...boardOpts } = opts;
  const results: RunBoardResult[] = new Array(specIds.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= specIds.length) return;
      results[i] = await runBoard(specIds[i], config, boardOpts);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, specIds.length) }, worker));
  return results;
}
