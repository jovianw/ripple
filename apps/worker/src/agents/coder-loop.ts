// Board runner: spec -> retrieve memory -> coder -> hidden checker -> store
// RunResult -> on failure, critic diagnosis feeds the retry -> on pass, the
// critic's improve rounds try a smaller, cheaper board -> credit memory. runBoard does one spec; runBatch is the only batch runner — the
// config gate and the ablation both call it with whatever config they're
// scoring, not necessarily the current kept one.
import { createHash, randomUUID } from "node:crypto";
import type { BoardMetrics, HarnessConfig, RunResult, Spec } from "@ripple/types";
import { retrieveLessons, retrieveSubcircuits, addLesson, addSubcircuit, markLessonsHelped, markSubcircuitsReused, indexFailure } from "../harness/memory.js";
import { col } from "../db.js";
import { createComplete } from "../tools/router.js";
import { computeMetrics, MetricsError, type CircuitMetrics } from "../tools/metrics.js";
import { runCoder, CoderCompileError, type CoderResult } from "./coder.js";
import { runCritic, runImprover, type CriticResult, type ImproveInput } from "./critic/index.js";
import { boardRatio } from "../harness/quality.js";
import { fitBoardToParts } from "../tools/board-outline.js";
import { runDrc } from "../tools/drc.js";
import { evaluateCircuitSource, EvaluateError } from "../tools/evaluate.js";
import { describeLayout } from "./critic/layout.js";
import { bakePlacement, withoutPlacement } from "../tools/normalize.js";
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
  /**
   * Reuse an existing passing board instead of designing again, when one already exists for this exact key under
   * the current harness_version. Off by default: `runBatch` (the gate, the ablation) must never take this path —
   * they need a fresh, honest run to score the config, not a stale result borrowed from a previous version's pass.
   * Only the request-serving path (scripts/worker.ts) opts in. Use `specId` for a real spec; for free text, hash
   * the normalized text with `specCacheKey` — the same text can arrive with a different, per-request synthetic id.
   */
  cacheKey?: string;
}

/** Stable key for an exact-match cache lookup on free text: same normalized wording, same key. */
export function specCacheKey(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
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
  /** Set when the board passed: what the critic's improve rounds did to it. */
  improve?: ImproveOutcome;
}

/** Improve rounds after a pass: at most this many critic reviews + coder edits (fewer when the critic runs out of edits). */
export const IMPROVE_ROUNDS = 3;

export interface ImproveOutcome {
  /** The passing board before any improvement. */
  before: CircuitMetrics;
  /** The board that was kept (same as before when no round was adopted). */
  after?: CircuitMetrics;
  rounds: {
    edits: string[];
    expected: string;
    /** The edited board passed every hidden check (true for a round with no edits). */
    passed: boolean;
    /** boardRatio(previous kept board, edited board); null when it didn't pass or there were no edits. */
    ratio: number | null;
    adopted: boolean;
    after?: CircuitMetrics;
    failures?: RunResult["failures"];
  }[];
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
  const expectedFor = (circuitJson: unknown) => (opts.expectedFor ? opts.expectedFor(circuitJson) : checks.loadExpected(specId));

  if (opts.cacheKey) {
    const cached = await col.boards.findOne(
      { cache_key: opts.cacheKey, harness_version: config.version, passed: true },
      { sort: { created_at: -1 } },
    );
    // harness_version only tracks the config: the checks, normalizer or coder can change under the same version.
    // Re-grade the stored design against today's checks (no model calls) and serve it only if it still passes.
    const recheck = cached ? await checks.runChecks(cached.circuit_json, expectedFor(cached.circuit_json), { board_id: boardId, harness_version: config.version }) : null;
    if (cached && recheck?.passed) {
      const run: RunResult = { ...recheck, stage: "cache_hit" };
      await col.runs.replaceOne(
        { _id: `${boardId}_1` },
        { ...run, spec_id: specId, check_score: 1, quality: computeMetrics(cached.circuit_json), final: true },
        { upsert: true },
      );
      // A copy under this request's own board_id, not a pointer to the original: every other view
      // (`/boards/<id>`, the harness timeline) already assumes one board_id per request.
      await col.boards.insertOne({
        board_id: boardId,
        kind: cached.kind ?? "single",
        spec_id: specId,
        harness_version: config.version,
        source: cached.source ?? "",
        circuit_json: cached.circuit_json ?? null,
        passed: true,
        failures: [],
        cache_key: opts.cacheKey,
        cached_from: cached.board_id,
        created_at: new Date(),
      });
      return { specId: spec._id, boardId, attempts: 0, runResult: run, criticResults: [], checkScore: 1 };
    }
  }

  const expected = opts.expectedFor ? undefined : checks.loadExpected(specId);
  const completeCritic = createComplete("critic", config);

  const [lessons, subcircuits] = useMemory
    ? await Promise.all([retrieveLessons(spec.text, config.context), retrieveSubcircuits(spec.text, config.context)])
    : [[], []];

  // A rerun under the same board id starts over: no earlier run is the kept one any more.
  if (opts.boardId) await col.runs.updateMany({ board_id: boardId, final: true }, { $unset: { final: "" } });

  /** Hidden checks and partial credit for one compiled design. */
  const grade = async (
    circuitJson: unknown,
    metrics: CircuitMetrics,
    model?: CoderResult["model"],
  ): Promise<{ runResult: RunResult; checkScore: number }> => {
    const exp = opts.expectedFor ? opts.expectedFor(circuitJson) : expected;
    const checked = await checks.runChecks(circuitJson, exp, { board_id: boardId, harness_version: config.version });
    return {
      runResult: {
        ...checked,
        metrics: toBoardMetrics(metrics),
        ...(model && { model: model.tier, tokens: model.totalTokens, cost_usd: model.costUsd }),
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
      ...(opts.cacheKey && { cache_key: opts.cacheKey }),
      created_at: new Date(),
    });

  let coderResult: CoderResult | undefined;
  let runResult: RunResult | undefined;
  let previousFailure: string | undefined;
  let previousFailures: RunResult["failures"] | undefined;
  let source: string | undefined;
  /** The code a repair starts from: the last attempt's, with the positions tscircuit chose written in. */
  let repairSource: string | undefined;
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
        // Repairs edit the last attempt's code (including code that didn't compile) instead of starting over.
        previousSource: config.context.include_last_failure && previousFailure ? repairSource : undefined,
      });
      source = coderResult.source;
      // Auto-placed parts move whenever another part gets a position, which would make the critic's positions
      // (and the layout's clear spots) wrong by the next render. Pinning where they are now keeps them valid.
      repairSource = bakePlacement(withoutPlacement(source), coderResult.circuitJson as never);
      ({ runResult, checkScore } = await grade(coderResult.circuitJson, coderResult.metrics, coderResult.model));
    } catch (err) {
      if (!(err instanceof CoderCompileError)) throw err;
      coderResult = undefined;
      source = err.source;
      repairSource = err.source;
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
          code: repairSource ?? source ?? "",
          result: runResult,
          previousFailures,
          lessons: lessons.map((l) => ({ _id: l._id, pattern: l.pattern, fix: l.fix })),
          rules: config.rules,
          attempt: attempts,
          repairBudget: maxAttempts,
          layout: coderResult ? describeLayout(coderResult.circuitJson) : undefined,
        },
        { complete: completeCritic, ...(writeMemory && { addLesson }) },
      );
      criticResults.push(critic);
      previousFailure = [...critic.diagnosis.map((d) => `${d.check}: ${d.cause}`), ...critic.fix].join("\n");

      // Log the critic's own model call so its cost isn't invisible to scoreVersion's
      // per-board sum (attributed to this board — the repair it's fixing).
      if (completeCritic.lastUsage) {
        const u = completeCritic.lastUsage;
        // replaceOne, like the checks run: a resumed request reruns its attempts under the same board id.
        await col.runs.replaceOne({ _id: `${boardId}_${attempts}_critique` }, {
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
          // What the critic told the coder, so a repair that didn't work can be read back.
          critique: {
            diagnosis: critic.diagnosis,
            fix: critic.fix,
            escalate: critic.escalate,
            ...(critic.escalate_reason && { escalate_reason: critic.escalate_reason }),
            lessons_saved: critic.saved_lesson_ids,
          },
        }, { upsert: true });
      }
    }

    previousFailures = runResult.failures;
  }

  if (!runResult) throw new Error(`runBoard(${specId}) produced no result`);

  // Improve rounds: the board passed, so the critic reviews it for size, routing and cost (critic/improve.ts) and
  // the coder applies its edits to the pinned code. The edited board is graded by the hidden checks and kept only if
  // it still passes and is a better board (harness/quality.ts). A discarded round goes back to the critic in the next
  // one (what its edits broke, or that they didn't help), so it corrects course instead of repeating itself; the
  // rounds end when the critic has nothing left to suggest. Stages "improve_critique" / "improve": not attempts, but
  // their cost counts.
  let improve: ImproveOutcome | undefined;
  let keptRunId = runResult.passed ? `${boardId}_${attempts}` : undefined;
  if (runResult.passed && coderResult) {
    improve = { before: coderResult.metrics, rounds: [] };
    let lastTry: ImproveInput["lastTry"];
    for (let round = 1; round <= IMPROVE_ROUNDS; round++) {
      const current: CoderResult = coderResult;
      const pinned = bakePlacement(withoutPlacement(current.source), current.circuitJson as never);
      const review = await runImprover(
        { spec, code: pinned, circuitJson: current.circuitJson, metrics: current.metrics, rules: config.rules, lastTry },
        { complete: completeCritic },
      );
      if (completeCritic.lastUsage) {
        const u = completeCritic.lastUsage;
        await col.runs.replaceOne({ _id: `${boardId}_improve${round}_critique` }, {
          board_id: boardId,
          harness_version: config.version,
          stage: "improve_critique",
          passed: false,
          failures: [],
          drc_errors: 0,
          model: u.tier,
          tokens: u.totalTokens,
          cost_usd: u.costUsd,
          ts: new Date().toISOString(),
          improve: { edits: review.edits, expected: review.expected },
        }, { upsert: true });
      }
      if (!review.edits.length) {
        improve.rounds.push({ edits: [], expected: review.expected, passed: true, ratio: null, adopted: false });
        break;
      }

      const runId = `${boardId}_improve${round}`;
      let edited: CoderResult | undefined;
      let run: RunResult;
      let score = 0;
      try {
        const coded = await runCoder({ specText: spec.text, config, lessons, subcircuits, previousSource: pinned, improvements: review.edits });
        // The critic places the parts; the board is sized to wrap them (tools/board-outline.ts) and rendered again.
        const fitted = fitBoardToParts(coded.source, coded.circuitJson);
        try {
          const { circuitJson } = await evaluateCircuitSource(fitted);
          edited = { ...coded, source: fitted, circuitJson, drc: runDrc(circuitJson), metrics: computeMetrics(circuitJson) };
        } catch (err) {
          if (!(err instanceof EvaluateError || err instanceof MetricsError)) throw err;
          throw new CoderCompileError(`board sized to its parts did not render: ${err.message}`, fitted, coded.model, { cause: err });
        }
        ({ runResult: run, checkScore: score } = await grade(edited.circuitJson, edited.metrics, edited.model));
      } catch (err) {
        if (!(err instanceof CoderCompileError)) throw err;
        run = compileFailure(err);
      }
      run = { ...run, stage: "improve" };
      await saveRun(runId, run, score, edited?.metrics);
      const ratio = edited && run.passed ? boardRatio(current.metrics, edited.metrics) : null;
      const adopted = ratio !== null && ratio > 1;
      improve.rounds.push({ edits: review.edits, expected: review.expected, passed: run.passed, ratio, adopted, after: edited?.metrics, failures: run.failures });
      if (!adopted || !edited) {
        lastTry = {
          edits: review.edits,
          outcome: run.passed
            ? `it passed but wasn't a better board: ${edited ? `${edited.metrics.area_mm2.toFixed(0)} mm², routing ${edited.metrics.detour.toFixed(2)}x, ${edited.metrics.vias} vias` : ""}`
            : `it failed: ${run.failures.slice(0, 6).map((f) => `${f.check}: ${f.detail}`).join(" | ").slice(0, 900)}`,
        };
        continue;
      }
      lastTry = undefined;
      await saveBoard(run, edited.source, edited.circuitJson);
      coderResult = edited;
      source = edited.source;
      runResult = run;
      keptRunId = runId;
    }
    improve.after = coderResult.metrics;
  }
  // The kept board's run, for scoreVersion's board quality.
  if (keptRunId) await col.runs.updateOne({ _id: keptRunId }, { $set: { final: true } });

  // Episodic memory: a failed board becomes searchable by what went wrong (memory.similarFailures).
  if (!runResult.passed && writeMemory && runResult.failures.length) {
    const summary = `${specId}: ${runResult.failures.slice(0, 6).map((f) => `${f.check}: ${f.detail}`).join(" | ")}`.slice(0, 800);
    await indexFailure(`${boardId}_${attempts}`, summary).catch((err) => console.warn(`indexFailure skipped: ${(err as Error).message}`));
  }

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

  return { specId, boardId, attempts, runResult, coderResult, source, criticResults, checkScore: bestCheckScore, improve };
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
