// Config gate: scores harness config versions from their runs and decides whether a proposed version is kept,
// rolled back, or rejected. Owner: Jovian.
// The gate never calls models itself: the batch runner (Arjun's runBatch) is passed in, so the same scoring
// serves the gate, the ablation table and the UI.
import type { HarnessConfig } from "@ripple/types";
import type { Collection } from "mongodb";
import { col, type StoredConfig, type StoredRun } from "../db.js";
import { defaultWorkerId } from "./queue.js";

type HarnessScores = NonNullable<HarnessConfig["scores"]>;

/** Runs a batch of boards under `config` (every run stamped with config.version) and returns their board ids. */
export type RunBatch = (config: HarnessConfig) => Promise<{ boardIds: string[] }>;

export interface GateStore {
  harness: Collection<StoredConfig>;
  runs: Collection<StoredRun>;
}
const defaultStore = (): GateStore => ({ harness: col.harness, runs: col.runs });

export type Scores = HarnessScores & { boards: number };

/**
 * Scores a version from its runs. Per board: passed if any attempt passed, attempts = "checks" runs,
 * cost = every run's cost_usd (coder, critic, ...). Then averaged over boards:
 * checks_passed = share of boards that passed all hidden checks.
 * Pass `boardIds` to score one batch only (the gate does); omit to score everything run under that version.
 */
export async function scoreVersion(
  version: number,
  opts: { boardIds?: string[]; store?: GateStore } = {},
): Promise<Scores | null> {
  const { runs } = opts.store ?? defaultStore();
  const [s] = await runs
    .aggregate<Scores>([
      { $match: { harness_version: version, ...(opts.boardIds && { board_id: { $in: opts.boardIds } }) } },
      {
        $group: {
          _id: "$board_id",
          passed: { $max: { $cond: ["$passed", 1, 0] } },
          attempts: { $sum: { $cond: [{ $eq: ["$stage", "checks"] }, 1, 0] } },
          cost: { $sum: { $ifNull: ["$cost_usd", 0] } },
        },
      },
      {
        $group: {
          _id: null,
          boards: { $sum: 1 },
          checks_passed: { $avg: "$passed" },
          attempts_per_board: { $avg: "$attempts" },
          cost_per_board_usd: { $avg: "$cost" },
        },
      },
      { $project: { _id: 0 } },
    ])
    .toArray();
  return s ?? null;
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

/** Better = more boards pass; on a tie, fewer attempts, then lower cost. */
export function isBetter(candidate: HarnessScores, parent: HarnessScores): boolean {
  const eps = 1e-9;
  if (Math.abs(candidate.checks_passed - parent.checks_passed) > eps) return candidate.checks_passed > parent.checks_passed;
  if (Math.abs(candidate.attempts_per_board - parent.attempts_per_board) > eps)
    return candidate.attempts_per_board < parent.attempts_per_board;
  return candidate.cost_per_board_usd < parent.cost_per_board_usd;
}

const strip = ({ _id, gate_note, decided_at, claimed_by, claimed_at, ...c }: StoredConfig & { _id?: unknown }): HarnessConfig => c;

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

async function runAndScore(config: HarnessConfig, runBatch: RunBatch, store: GateStore): Promise<Scores> {
  const { boardIds } = await runBatch(config);
  const scores = await scoreVersion(config.version, { boardIds, store });
  if (!scores) throw new Error(`batch under v${config.version} produced no runs`);
  return scores;
}

export interface GateDecision {
  version: number;
  parent: number;
  verdict: "kept" | "rolled_back" | "rejected";
  reasons: string[];
  scores?: Scores;
  parentScores?: Scores;
}

/**
 * Decides the oldest pending version nobody else is already evaluating:
 *   guardrail violation → "rejected" (no batch run);
 *   otherwise run a batch under it (and under its parent if the parent has no scores yet),
 *   then "kept" if it scores better than its parent, else "rolled_back".
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
  const workerId = opts.workerId ?? defaultWorkerId();
  const claimed = await claimPending(store.harness, workerId);
  if (!claimed) return null;

  const record = async (d: GateDecision) => {
    const res = await store.harness.updateOne(
      { version: d.version, claimed_by: workerId },
      {
        $set: {
          verdict: d.verdict,
          ...(d.scores && { scores: stripBoards(d.scores) }),
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
    const head = await store.harness.findOne({ verdict: "kept" }, { sort: { version: -1 }, projection: { version: 1 } });
    if (head && head.version !== parent.version) {
      return await record({
        version: candidate.version,
        parent: parent.version,
        verdict: "rolled_back",
        reasons: [`stale: proposed from v${parent.version}, but v${head.version} is current now; re-propose from it`],
      });
    }

    const violations = guardrailViolations(parent, candidate);
    if (violations.length)
      return await record({ version: candidate.version, parent: parent.version, verdict: "rejected", reasons: violations });

    let parentScores = (parent.scores as Scores | undefined) ?? undefined;
    if (!parentScores) {
      const reused = opts.parentBoardIds?.length
        ? await scoreVersion(parent.version, { boardIds: opts.parentBoardIds, store })
        : null;
      parentScores = reused ?? (await runAndScore(parent, runBatch, store));
      await store.harness.updateOne({ version: parent.version }, { $set: { scores: stripBoards(parentScores) } });
    }
    const scores = await runAndScore(candidate, runBatch, store);
    const better = isBetter(scores, parentScores);
    const fmt = (s: HarnessScores) =>
      `pass ${(s.checks_passed * 100).toFixed(0)}%, ${s.attempts_per_board.toFixed(1)} attempts, $${s.cost_per_board_usd.toFixed(4)}/board`;
    return await record({
      version: candidate.version,
      parent: parent.version,
      verdict: better ? "kept" : "rolled_back",
      reasons: [`v${candidate.version} ${fmt(scores)} vs v${parent.version} ${fmt(parentScores)}`],
      scores,
      parentScores,
    });
  } catch (err) {
    // Release the claim so a retry doesn't have to wait out CLAIM_STALE_MS; leave the version pending.
    await store.harness.updateOne(
      { version: claimed.version, claimed_by: workerId },
      { $unset: { claimed_by: "", claimed_at: "" } },
    );
    throw err;
  }
}

const stripBoards = ({ checks_passed, attempts_per_board, cost_per_board_usd }: HarnessScores): HarnessScores => ({
  checks_passed,
  attempts_per_board,
  cost_per_board_usd,
});
