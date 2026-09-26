// Board runner: spec -> retrieve memory -> coder -> hidden checker -> store
// RunResult -> on failure, critic diagnosis feeds the retry -> on pass, one
// optimize pass tries a smaller, cleaner board -> credit memory. runBoard does
// one spec; runBatch is the only batch runner — the config gate and the
// ablation both call it with whatever config they're scoring, not necessarily
// the current kept one.
import { randomUUID } from "node:crypto";
import type { BoardMetrics, HarnessConfig, RunResult, Spec } from "@ripple/types";
import { retrieveLessons, retrieveSubcircuits, addLesson, addSubcircuit, markLessonsHelped, markSubcircuitsReused } from "../harness/memory.js";
import { boardRatio } from "../harness/quality.js";
import { col } from "../db.js";
import { createComplete } from "../tools/router.js";
import type { CircuitMetrics } from "../tools/metrics.js";
import { runCoder, CoderCompileError, type CoderResult } from "./coder.js";
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
  /** Retrieve lessons and library subcircuits. Turn off for the ablation's v0 row ("loop + checks", no learned memory). Default true. */
  useMemory?: boolean;
  /** Run this spec instead of looking `specId` up (free text from the web app). */
  spec?: Spec;
  /** For a spec with no hidden-check file: builds the checks from each attempt's Circuit JSON (Marcos's generic checks). */
  expectedFor?: (circuitJson: unknown) => unknown;
}

/** What the optimize pass did after the board passed. */
export interface OptimizeOutcome {
  /** Kept: it passed and boardRatio(before, after) > 1. */
  adopted: boolean;
  /** boardRatio(before, after); null when the optimized board didn't compile or didn't pass. */
  ratio: number | null;
  before: CircuitMetrics;
  /** Undefined when the optimized code didn't compile. */
  after?: CircuitMetrics;
  failures: RunResult["failures"];
}

export interface RunBoardResult {
  specId: string;
  boardId: string;
  attempts: number;
  runResult: RunResult;
  /** Undefined when no attempt compiled, or when the board errored before finishing (see runResult.failures). */
  coderResult?: CoderResult;
  /** Last generated source, including code that didn't compile. */
  source?: string;
  criticResults: CriticResult[];
  /** Best partial credit over the attempts (0..1); 1 when the board passed. */
  checkScore: number;
  /** Set when the board passed. */
  optimize?: OptimizeOutcome;
}

type Checks = {
  runChecks: (json: unknown, expected: unknown, meta?: { board_id?: string; harness_version?: number }) => Promise<RunResult>;
  loadExpected: (id: string) => unknown;
  checkScore: (result: Pick<RunResult, "failures">, expected: unknown) => number;
};

/** The hidden checker, loaded by path at runtime so checks/ stays out of the worker's build (same as assembler.ts). */
async function loadChecks(): Promise<Checks> {
  return (await import(new URL("../../../../checks/index.ts", import.meta.url).href)) as Checks;
}

function toBoardMetrics(m: CircuitMetrics): BoardMetrics {
  return { area_mm2: m.area_mm2, vias: m.vias, trace_mm: m.trace_mm, bom_usd: m.bom_usd };
}

export async function runBoard(specId: string, config: HarnessConfig, opts: RunBoardOptions = {}): Promise<RunBoardResult> {
  const { boardId = randomUUID(), writeMemory = true, useMemory = true } = opts;
  const spec = opts.spec ?? findSpec(specId);
  const checks = await loadChecks();
  const expected = opts.expectedFor ? undefined : checks.loadExpected(specId);
  const completeCritic = createComplete("critic", config);

  const [lessons, subcircuits] = useMemory
    ? await Promise.all([retrieveLessons(spec.text, config.context), retrieveSubcircuits(spec.text, config.context)])
    : [[], []];

  // A rerun under the same board id starts over: no earlier run is the kept one any more.
  if (opts.boardId) await col.runs.updateMany({ board_id: boardId, final: true }, { $unset: { final: "" } });

  /** Hidden checks and partial credit for one compiled design. */
  const grade = async (coded: CoderResult): Promise<{ runResult: RunResult; checkScore: number }> => {
    const exp = opts.expectedFor ? opts.expectedFor(coded.circuitJson) : expected;
    const checked = await checks.runChecks(coded.circuitJson, exp, { board_id: boardId, harness_version: config.version });
    return {
      runResult: {
        ...checked,
        metrics: toBoardMetrics(coded.metrics),
        model: coded.model.tier,
        tokens: coded.model.totalTokens,
        cost_usd: coded.model.costUsd,
      },
      checkScore: checks.checkScore(checked, exp),
    };
  };
  /** Code that doesn't compile or render is a failed attempt, not a crash: record it and let the critic fix it. */
  const compileFailure = (err: CoderCompileError): RunResult => ({
    board_id: boardId,
    harness_version: config.version,
    stage: "compile",
    passed: false,
    failures: [{ check: "compile", detail: err.message }],
    drc_errors: 0,
    model: err.model.tier,
    tokens: err.model.totalTokens,
    cost_usd: err.model.costUsd,
    ts: new Date().toISOString(),
  });
  const saveRun = (_id: string, run: RunResult, checkScore: number, quality?: CircuitMetrics) =>
    col.runs.replaceOne(
      { _id },
      {
        ...run,
        spec_id: specId,
        check_score: checkScore,
        ...(quality && { quality }),
        lessons_used: lessons.map((l) => l._id),
        subcircuits_used: subcircuits.map((s) => s._id),
      },
      { upsert: true },
    );
  // Same shape as the finale's final board (docs/frontend-backend.md) —
  // insertOne with an auto _id, matching the finale pipeline's convention (planned-board.ts):
  // boards accumulate one doc per attempt, consumers take the latest by created_at.
  const saveBoard = (run: RunResult, boardSource: string, circuitJson: unknown) =>
    col.boards.insertOne({
      board_id: boardId,
      kind: "single",
      spec_id: specId,
      harness_version: config.version,
      source: boardSource,
      circuit_json: circuitJson,
      passed: run.passed,
      failures: run.failures,
      created_at: new Date(),
    });

  let coderResult: CoderResult | undefined;
  let runResult: RunResult | undefined;
  let previousFailure: string | undefined;
  let previousFailures: RunResult["failures"] | undefined;
  let source: string | undefined;
  const criticResults: CriticResult[] = [];
  let attempts = 0;
  let bestCheckScore = 0;
  const maxAttempts = Math.max(1, config.workflow.repair_budget);

  while (attempts < maxAttempts) {
    attempts++;
    let checkScore = 0;
    try {
      coderResult = await runCoder({
        specText: spec.text,
        config,
        lessons,
        subcircuits,
        previousFailure: config.context.include_last_failure ? previousFailure : undefined,
      });
      source = coderResult.source;
      ({ runResult, checkScore } = await grade(coderResult));
    } catch (err) {
      if (!(err instanceof CoderCompileError)) throw err;
      coderResult = undefined;
      source = err.source;
      runResult = compileFailure(err);
    }
    bestCheckScore = Math.max(bestCheckScore, checkScore);

    await saveRun(`${boardId}_${attempts}`, runResult, checkScore, coderResult?.metrics);
    await saveBoard(runResult, source ?? "", coderResult?.circuitJson ?? null);

    if (runResult.passed) break;

    // Critic diagnoses the failure and proposes the smallest fix; that fix
    // (not just the raw failure list) becomes the next attempt's context.
    // Lessons it writes are stored immediately (memory.addLesson), so they
    // can help other boards even if this one keeps failing — unless writeMemory is off.
    if (attempts < maxAttempts) {
      const critic = await runCritic(
        {
          spec: { _id: spec._id, text: spec.text, split: spec.split },
          code: source ?? "",
          result: runResult,
          previousFailures,
          lessons: lessons.map((l) => ({ _id: l._id, pattern: l.pattern, fix: l.fix })),
          rules: config.rules,
          attempt: attempts,
          repairBudget: maxAttempts,
        },
        { complete: completeCritic, ...(writeMemory && { addLesson }) },
      );
      criticResults.push(critic);
      previousFailure = [...critic.diagnosis.map((d) => `${d.check}: ${d.cause}`), ...critic.fix].join("\n");

      // Log the critic's own model call so its cost isn't invisible to scoreVersion's
      // per-board sum (attributed to this board — the repair it's fixing).
      if (completeCritic.lastUsage) {
        const u = completeCritic.lastUsage;
        await col.runs.insertOne({
          _id: `${boardId}_${attempts}_critique`,
          board_id: boardId,
          harness_version: config.version,
          stage: "critique",
          passed: false,
          failures: [],
          drc_errors: 0,
          model: u.tier,
          tokens: u.totalTokens,
          cost_usd: u.costUsd,
          ts: new Date().toISOString(),
        });
      }
    }

    previousFailures = runResult.failures;
  }

  if (!runResult) throw new Error(`runBoard(${specId}) produced no result`);

  // Optimize pass: one more coder call on the passing design, asking for a smaller, cleaner board with the same
  // parts and connections. Kept only if it still passes every hidden check and is better (harness/quality.ts).
  // Stage "optimize", so scoreVersion doesn't count it as an attempt; its cost still counts.
  let optimize: OptimizeOutcome | undefined;
  let keptRunId = runResult.passed ? `${boardId}_${attempts}` : undefined;
  if (runResult.passed && coderResult) {
    const before = coderResult;
    const optId = `${boardId}_optimize`;
    let after: CoderResult | undefined;
    let optRun: RunResult;
    let optScore = 0;
    try {
      after = await runCoder({ specText: spec.text, config, lessons, subcircuits, optimizeFrom: { source: before.source, metrics: before.metrics, circuitJson: before.circuitJson } });
      ({ runResult: optRun, checkScore: optScore } = await grade(after));
    } catch (err) {
      if (!(err instanceof CoderCompileError)) throw err;
      optRun = compileFailure(err);
    }
    optRun = { ...optRun, stage: "optimize" };
    const ratio = after && optRun.passed ? boardRatio(before.metrics, after.metrics) : null;
    const adopted = ratio !== null && ratio > 1;
    await saveRun(optId, optRun, optScore, after?.metrics);
    optimize = { adopted, ratio, before: before.metrics, after: after?.metrics, failures: optRun.failures };
    if (adopted && after) {
      await saveBoard(optRun, after.source, after.circuitJson);
      coderResult = after;
      source = after.source;
      runResult = optRun;
      keptRunId = optId;
    }
  }
  if (keptRunId) await col.runs.updateOne({ _id: keptRunId }, { $set: { final: true } });

  if (runResult.passed && coderResult && writeMemory) {
    await addSubcircuit({
      name: `board_${specId}`,
      description: spec.text,
      code: coderResult.source,
      checks_passed: [specId],
    });
    await markLessonsHelped(lessons.map((l) => l._id));
    await markSubcircuitsReused(subcircuits.map((s) => s._id));
  }

  return { specId, boardId, attempts, runResult, coderResult, source, criticResults, checkScore: bestCheckScore, optimize };
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
      // One board's error (rate limit, bad critic JSON...) must not throw away the rest of the batch.
      try {
        results[i] = await runBoard(specIds[i], config, boardOpts);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        results[i] = {
          specId: specIds[i],
          boardId: boardOpts.boardId ?? "",
          attempts: 0,
          criticResults: [],
          checkScore: 0,
          runResult: {
            board_id: boardOpts.boardId ?? "",
            harness_version: config.version,
            stage: "error",
            passed: false,
            failures: [{ check: "error", detail: detail.slice(0, 500) }],
            drc_errors: 0,
            ts: new Date().toISOString(),
          },
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, specIds.length) }, worker));
  return results;
}
