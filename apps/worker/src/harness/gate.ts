// Config gate: scores harness config versions from their runs and decides whether a proposed version is kept,
// rolled back, or rejected. Owner: Jovian.
// The gate never calls models itself: the batch runner (Arjun's runBatch) is passed in, so the same scoring
// serves the gate, the ablation table and the UI.
import type { BoardQualityMeans, HarnessConfig } from "@ripple/types";
import { randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import { col, type StoredConfig, type StoredRun } from "../db.js";
import { qualityVsParent, type BoardQuality, type QualityComparison, type RunQuality } from "./quality.js";
import { defaultWorkerId } from "./queue.js";

type HarnessScores = NonNullable<HarnessConfig["scores"]>;

/** Runs a batch of boards under `config` (every run stamped with config.version) and returns their board ids. */
export type RunBatch = (config: HarnessConfig) => Promise<{ boardIds: string[] }>;

export interface GateStore {
  harness: Collection<StoredConfig>;
  runs: Collection<StoredRun>;
}
const defaultStore = (): GateStore => ({ harness: col.harness, runs: col.runs });

export type Scores = HarnessScores & { boards: number; check_score: number; board: BoardQualityMeans | null };

/** One board's runs under a version, rolled up. */
interface BoardRow {
  _id: string;
  spec_id: string | null;
  passed: number;
  attempts: number;
  cost: number;
  check_score: number | null;
  /** quality of the run marked final (the kept board); one entry when the board passed, none otherwise */
  finals: RunQuality[];
}

async function boardRows(version: number, opts: { boardIds?: string[]; store?: GateStore }): Promise<BoardRow[]> {
  const { runs } = opts.store ?? defaultStore();
  const rows = await runs
    .aggregate<BoardRow>([
      { $match: { harness_version: version, ...(opts.boardIds && { board_id: { $in: opts.boardIds } }) } },
      {
        $group: {
          _id: "$board_id",
          spec_id: { $max: "$spec_id" },
          passed: { $max: { $cond: ["$passed", 1, 0] } },
          attempts: { $sum: { $cond: [{ $eq: ["$stage", "checks"] }, 1, 0] } },
          cost: { $sum: { $ifNull: ["$cost_usd", 0] } },
          check_score: { $max: "$check_score" },
          finals: { $push: { $cond: [{ $eq: ["$final", true] }, "$quality", "$$REMOVE"] } },
        },
      },
    ])
    .toArray();
  // Runs from before partial credit and board quality were recorded can't be scored: rerun them, don't guess.
  const unscored = rows.filter((r) => r.check_score === null || r.spec_id === null).map((r) => r._id);
  if (unscored.length)
    throw new Error(`v${version}: ${unscored.length} board(s) have runs without spec_id/check_score (recorded before graded scoring): ${unscored.slice(0, 5).join(", ")}`);
  for (const r of rows)
    if (r.finals.length !== r.passed)
      throw new Error(`v${version}: board ${r._id} ${r.passed ? "passed" : "failed"} but has ${r.finals.length} final run(s)`);
  return rows;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Scores a version from its runs. Per board: passed if any attempt passed, attempts = "checks" runs,
 * cost = every run's cost_usd (coder, critic, ...), check_score = best attempt's partial credit.
 * Then averaged over boards: checks_passed = share of boards that passed all hidden checks.
 * `board` = mean quality of the kept boards of the passing ones (display: the gate compares quality per spec).
 * Pass `boardIds` to score one batch only (the gate does); omit to score everything run under that version.
 * Throws on boards with runs from before graded scoring.
 */
export async function scoreVersion(
  version: number,
  opts: { boardIds?: string[]; store?: GateStore } = {},
): Promise<Scores | null> {
  const rows = await boardRows(version, opts);
  if (!rows.length) return null;
  const finals = rows.flatMap((r) => r.finals);
  return {
    boards: rows.length,
    checks_passed: mean(rows.map((r) => r.passed)),
    attempts_per_board: mean(rows.map((r) => r.attempts)),
    cost_per_board_usd: mean(rows.map((r) => r.cost)),
    check_score: mean(rows.map((r) => r.check_score as number)),
    board: finals.length
      ? {
          area_mm2: mean(finals.map((q) => q.area_mm2)),
          density: mean(finals.map((q) => q.density)),
          detour: mean(finals.map((q) => q.detour)),
          vias: mean(finals.map((q) => q.vias)),
          parts: mean(finals.map((q) => q.parts)),
          bom_usd: mean(finals.map((q) => q.bom_usd)),
        }
      : null,
  };
}

/** Spec id -> quality of the kept board, for the passing boards of a batch. Throws if the batch built a spec twice. */
export async function specQuality(
  version: number,
  opts: { boardIds?: string[]; store?: GateStore } = {},
): Promise<Map<string, BoardQuality>> {
  const out = new Map<string, BoardQuality>();
  for (const r of await boardRows(version, opts)) {
    if (!r.passed) continue;
    const spec = r.spec_id as string;
    if (out.has(spec)) throw new Error(`v${version}: spec ${spec} was built by more than one board in this batch`);
    out.set(spec, r.finals[0]);
  }
  return out;
}

// Read-only MCP tools an agent may be granted; anything else could write or drop data.
const READ_ONLY_MCP = new Set(["find", "aggregate", "count", "list-collections", "list-databases", "collection-schema", "collection-indexes", "explain"]);

/**
 * Changes the meta-agent is never allowed to make, whatever the scores say. A violation means "rejected"
 * without spending anything on a test batch.
 */
export function guardrailViolations(parent: HarnessConfig, candidate: HarnessConfig): string[] {
  const v: string[] = [];
  const removed = parent.rules.filter((r) => !candidate.rules.includes(r));
  if (removed.length) v.push(`removes existing rule(s): ${removed.map((r) => `"${r}"`).join(", ")}`);
  if (parent.tools.route_requires_connectivity && !candidate.tools.route_requires_connectivity)
    v.push("turns off the connectivity check before autorouting");
  if (candidate.tools.parts_whitelist !== parent.tools.parts_whitelist)
    v.push(`swaps the parts whitelist (${parent.tools.parts_whitelist} → ${candidate.tools.parts_whitelist})`);
  if (candidate.tools.mcp.coder.length) v.push("gives the coder database (MCP) tools");
  for (const [agent, tools] of Object.entries(candidate.tools.mcp)) {
    const bad = tools.filter((t) => !READ_ONLY_MCP.has(t));
    if (bad.length) v.push(`gives ${agent} non-read-only MCP tools: ${bad.join(", ")}`);
  }
  const { repair_budget, split_over_parts } = candidate.workflow;
  if (repair_budget < 1 || repair_budget > 6) v.push(`repair_budget ${repair_budget} outside 1..6 (cost cap)`);
  if (split_over_parts < 4) v.push(`split_over_parts ${split_over_parts} below 4`);
  const { lessons_k, subcircuits_k } = candidate.context;
  if (lessons_k < 0 || lessons_k > 10 || subcircuits_k < 0 || subcircuits_k > 10)
    v.push("context k outside 0..10 (context overload)");
  return v;
}

/** Partial credit within this of the parent's is a tie (noise from one flaky check on one board). */
export const CHECK_SCORE_TIE = 0.02;
/** Board quality within this of 1.0 (±3%) is a tie. */
export const QUALITY_TIE = 0.03;

/**
 * Correctness first, then board quality, then effort:
 *   1. more boards pass all hidden checks
 *   2. higher partial credit (ties within CHECK_SCORE_TIE)
 *   3. better boards, spec by spec (quality.ratio, ties within QUALITY_TIE; null = no shared spec = tie)
 *   4. fewer attempts
 *   5. lower cost
 */
export function isBetter(
  candidate: Pick<Scores, "checks_passed" | "check_score" | "attempts_per_board" | "cost_per_board_usd">,
  parent: Pick<Scores, "checks_passed" | "check_score" | "attempts_per_board" | "cost_per_board_usd">,
  quality: QualityComparison,
): boolean {
  const eps = 1e-9;
  if (Math.abs(candidate.checks_passed - parent.checks_passed) > eps) return candidate.checks_passed > parent.checks_passed;
  if (Math.abs(candidate.check_score - parent.check_score) > CHECK_SCORE_TIE) return candidate.check_score > parent.check_score;
  if (quality.ratio !== null && Math.abs(quality.ratio - 1) > QUALITY_TIE) return quality.ratio > 1;
  if (Math.abs(candidate.attempts_per_board - parent.attempts_per_board) > eps)
    return candidate.attempts_per_board < parent.attempts_per_board;
  return candidate.cost_per_board_usd < parent.cost_per_board_usd;
}

const strip = ({ _id, gate_note, decided_at, claimed_by, claimed_at, succeeded_by, quality_vs_parent, ...c }: StoredConfig & { _id?: unknown }): HarnessConfig => c;

// Unique per process: two `evolve` runs on one machine share a hostname, so defaultWorkerId() alone can't tell their claims apart.
const gateWorkerId = () => `${defaultWorkerId()}-${process.pid}-${randomUUID().slice(0, 8)}`;

// A batch can take several minutes; a claim older than this is assumed abandoned (the process died) and can be retaken.
const CLAIM_STALE_MS = 20 * 60 * 1000;

/**
 * Atomically claims the oldest pending version nobody else currently holds, so two concurrent `evolve` runs
 * (or a leftover process from an earlier one) never score and record the same version twice.
 */
async function claimPending(harness: Collection<StoredConfig>, workerId: string): Promise<StoredConfig | null> {
  const stale = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  return harness.findOneAndUpdate(
    { verdict: "pending", $or: [{ claimed_by: { $exists: false } }, { claimed_at: { $lt: stale } }] },
    { $set: { claimed_by: workerId, claimed_at: new Date().toISOString() } },
    { sort: { version: 1 }, returnDocument: "after" },
  );
}

interface Scored {
  scores: Scores;
  quality: Map<string, BoardQuality>;
}

async function scoreBatch(version: number, boardIds: string[], store: GateStore): Promise<Scored> {
  const scores = await scoreVersion(version, { boardIds, store });
  if (!scores) throw new Error(`batch under v${version} produced no runs`);
  return { scores, quality: await specQuality(version, { boardIds, store }) };
}

export interface GateDecision {
  version: number;
  parent: number;
  verdict: "kept" | "rolled_back" | "rejected";
  reasons: string[];
  scores?: Scores;
  parentScores?: Scores;
  /** Candidate's boards vs the parent's, spec by spec. */
  quality?: QualityComparison;
}

/**
 * Decides the oldest pending version nobody else is already evaluating:
 *   guardrail violation → "rejected" (no batch run);
 *   otherwise run a batch under it and score the parent on its own boards of the same specs (`parentBoardIds`,
 *   or a parent batch when none are given — stored parent scores are never reused, since board quality is
 *   compared spec by spec), then "kept" if it's better than its parent (isBetter), else "rolled_back".
 * Returns null when nothing claimable is pending. Every decision is stored on the version (scores, verdict, gate_note).
 *
 * Claims the version first (`claimPending`) so two concurrent callers (two people running `npm run evolve`, or a
 * leftover process from an earlier one) never both score and record the same version — the second one just sees
 * nothing pending and returns null instead of racing the first to a batch run and a verdict write.
 */
export async function evaluatePending(
  runBatch: RunBatch,
  opts: {
    store?: GateStore;
    /** a batch already run under the parent: scored instead of rerunning it */
    parentBoardIds?: string[];
    workerId?: string;
  } = {},
): Promise<GateDecision | null> {
  const store = opts.store ?? defaultStore();
  const workerId = opts.workerId ?? gateWorkerId();
  const claimed = await claimPending(store.harness, workerId);
  if (!claimed) return null;

  const record = async (d: GateDecision) => {
    const res = await store.harness.updateOne(
      { version: d.version, claimed_by: workerId },
      {
        $set: {
          verdict: d.verdict,
          ...(d.scores && { scores: stripBoards(d.scores) }),
          ...(d.quality && { quality_vs_parent: d.quality }),
          gate_note: d.reasons.join("; "),
          decided_at: new Date().toISOString(),
        },
        $unset: { claimed_by: "", claimed_at: "" },
      },
    );
    if (res.matchedCount !== 1) throw new Error(`lost claim on v${d.version} while recording its verdict`);
    return d;
  };

  try {
    const candidate = strip(claimed);
    const parentDoc = candidate.parent === null ? null : await store.harness.findOne({ version: candidate.parent });
    if (!parentDoc) throw new Error(`v${candidate.version} has no parent config`);
    const parent = strip(parentDoc);

    // Two people proposing off the same current config at once can produce sibling pending versions with the same
    // parent. If a sibling was already decided and is now current, this candidate's parent is stale: comparing it
    // against that stale parent could let a worse, later-numbered config outrank the sibling that's actually current
    // (currentConfig() just takes the newest "kept" version). Ask for a fresh proposal instead of spending a batch.
    // "rejected", not "rolled_back": it was never scored, so it didn't score worse.
    const stale = (current: number): GateDecision => ({
      version: candidate.version,
      parent: parent.version,
      verdict: "rejected",
      reasons: [`stale: proposed from v${parent.version}, but v${current} is current now; re-propose from it`],
    });
    const head = await store.harness.findOne({ verdict: "kept" }, { sort: { version: -1 }, projection: { version: 1 } });
    if (head && head.version !== parent.version) return await record(stale(head.version));

    const violations = guardrailViolations(parent, candidate);
    if (violations.length)
      return await record({ version: candidate.version, parent: parent.version, verdict: "rejected", reasons: violations });

    // The parent is scored on its own fresh boards of the same specs: the batch just run under it (parentBoardIds),
    // or a parent batch. Its stored scores may come from an earlier round with different specs, and board quality
    // is compared spec by spec, so they're never reused for the comparison. The fresh scores replace them.
    const parentBoardIds = opts.parentBoardIds?.length ? opts.parentBoardIds : (await runBatch(parent)).boardIds;
    const before = await scoreBatch(parent.version, parentBoardIds, store);
    const parentScores = before.scores;
    await store.harness.updateOne({ version: parent.version }, { $set: { scores: stripBoards(parentScores) } });
    const after = await scoreBatch(candidate.version, (await runBatch(candidate)).boardIds, store);
    const scores = after.scores;
    const quality = qualityVsParent(after.quality, before.quality);
    const better = isBetter(scores, parentScores, quality);
    const fmt = (s: Scores) =>
      `pass ${(s.checks_passed * 100).toFixed(0)}%, partial ${(s.check_score * 100).toFixed(0)}%, ` +
      `${s.attempts_per_board.toFixed(1)} attempts, $${s.cost_per_board_usd.toFixed(4)}/board`;
    const fmtQuality = (q: QualityComparison) =>
      q.ratio === null
        ? `board quality: no spec passed under both`
        : `board quality ${q.ratio >= 1 ? "+" : "−"}${(Math.abs(q.ratio - 1) * 100).toFixed(0)}% vs v${parent.version} (${q.shared} shared spec${q.shared === 1 ? "" : "s"})`;
    const decision: GateDecision = {
      version: candidate.version,
      parent: parent.version,
      verdict: better ? "kept" : "rolled_back",
      reasons: [`v${candidate.version} ${fmt(scores)} vs v${parent.version} ${fmt(parentScores)}`, fmtQuality(quality)],
      scores,
      parentScores,
      quality,
    };
    if (!better) return await record(decision);

    // A sibling claimed after this one passed the check above and was scored against the same parent in parallel.
    // Only one child may be kept on top of a parent: take the parent atomically; the loser is stale.
    const won = await store.harness.findOneAndUpdate(
      { version: parent.version, succeeded_by: { $exists: false } },
      { $set: { succeeded_by: candidate.version } },
    );
    if (!won) {
      const winner = await store.harness.findOne({ version: parent.version }, { projection: { succeeded_by: 1 } });
      return await record({ ...stale(winner?.succeeded_by ?? parent.version), scores, parentScores });
    }
    try {
      return await record(decision);
    } catch (err) {
      await store.harness.updateOne(
        { version: parent.version, succeeded_by: candidate.version },
        { $unset: { succeeded_by: "" } },
      );
      throw err;
    }
  } catch (err) {
    // Release the claim so a retry doesn't have to wait out CLAIM_STALE_MS; leave the version pending.
    await store.harness.updateOne(
      { version: claimed.version, claimed_by: workerId },
      { $unset: { claimed_by: "", claimed_at: "" } },
    );
    throw err;
  }
}

const stripBoards = ({ checks_passed, attempts_per_board, cost_per_board_usd, check_score, board }: Scores): HarnessScores => ({
  checks_passed,
  attempts_per_board,
  cost_per_board_usd,
  check_score,
  board,
});
