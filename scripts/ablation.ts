// Ablation: same model, held-out specs, three harness conditions (DESIGN.md §7).
//   npm run ablation
// Needs OPENROUTER_API_KEY, VOYAGE_API_KEY, MONGODB_URI. writeMemory: false
// throughout — held-out solutions never enter the subcircuit/lesson library.
import specs from "../specs/specs.json" with { type: "json" };
import { client, col } from "../apps/worker/src/db.ts";
import { BASELINE, currentConfig } from "../apps/worker/src/harness/config.ts";
import { scoreVersion, specQuality } from "../apps/worker/src/harness/gate.ts";
import { qualityVsParent, type QualityComparison } from "../apps/worker/src/harness/quality.ts";
import { callModel } from "../apps/worker/src/tools/router.ts";
import type { HarnessConfig, RunResult } from "@ripple/types";

// Structural subset of coder-loop.ts's RunBoardResult — not imported as a type
// because even `import type` walks the source file for resolution, which
// hits the same tscircuit/fanout-solver problem as a value import (see below).
interface RunBoardResult {
  boardId: string;
  runResult: RunResult;
  attempts: number;
}

// coder-loop.ts and evaluate.ts both reach "tscircuit", which scripts/tsconfig.json's
// plain NodeNext resolution can't statically walk (see apps/worker/tsconfig.json's
// moduleResolution/paths for the full story). Load them dynamically, like
// green-check.ts does for db.ts and coder-loop.ts does for checks/index.ts.
// gate.ts has no tscircuit dependency, so scoreVersion is imported statically above.
const { runBatch, findSpec } = (await import(new URL("../apps/worker/src/agents/coder-loop.ts", import.meta.url).href)) as {
  runBatch: (specIds: string[], config: HarnessConfig, opts?: { writeMemory?: boolean; useMemory?: boolean }) => Promise<RunBoardResult[]>;
  findSpec: (id: string) => { text: string };
};
const { evaluateCircuitSource, EvaluateError } = (await import(new URL("../apps/worker/src/tools/evaluate.ts", import.meta.url).href)) as {
  evaluateCircuitSource: (source: string) => Promise<{ circuitJson: unknown }>;
  EvaluateError: new (...args: never[]) => Error;
};

const HELD_OUT = (specs as { _id: string; split: string }[]).filter((s) => s.split === "held_out").map((s) => s._id);

interface Row {
  setup: string;
  harnessVersion: number;
  checksPassed: number;
  total: number;
  avgAttempts: number;
  avgCostUsd: number;
  /** Mean partial credit (0..1). */
  checkScore: number;
  /** vN row only: its boards vs v0's, spec by spec (harness/quality.ts). */
  qualityVsV0?: QualityComparison;
}

/** No harness at all: one model call, minimal prompt, no whitelist, no rules, no retries. */
async function runBareModel(specId: string, config: HarnessConfig) {
  const spec = findSpec(specId);
  const routerResult = await callModel({
    role: "coder",
    config,
    messages: [
      {
        role: "system",
        content: 'Write tscircuit TSX for the given spec. Reply with ONLY the code, no markdown, no explanation. Module shape: export default () => (<board>...</board>)',
      },
      { role: "user", content: spec.text },
    ],
  });
  const fenced = routerResult.content.match(/```(?:tsx|jsx|ts|js)?\n([\s\S]*?)```/);
  const source = (fenced ? fenced[1] : routerResult.content).trim();

  const checks = (await import(new URL("../checks/index.ts", import.meta.url).href)) as {
    runChecks: (json: unknown, expected: unknown) => Promise<RunResult>;
    loadExpected: (id: string) => unknown;
    checkScore: (result: Pick<RunResult, "failures">, expected: unknown) => number;
  };

  let passed = false;
  let checkScore = 0; // bare model with no whitelist/shape guidance often produces code that won't even evaluate
  const cost_usd = routerResult.costUsd;
  try {
    const { circuitJson } = await evaluateCircuitSource(source);
    const expected = checks.loadExpected(specId);
    const result = await checks.runChecks(circuitJson, expected);
    passed = result.passed;
    checkScore = checks.checkScore(result, expected);
  } catch (err) {
    if (!(err instanceof EvaluateError)) throw err;
  }
  return { passed, checkScore, attempts: 1, cost_usd };
}

/** Bare model has no config version of its own (it never writes runs); "bare" is a label, not a real version. */
function bareRow(setup: string, results: { passed: boolean; checkScore: number; attempts: number; cost_usd?: number }[]): Row {
  const total = results.length;
  return {
    setup,
    harnessVersion: -1,
    checksPassed: results.filter((r) => r.passed).length,
    total,
    avgAttempts: results.reduce((s, r) => s + r.attempts, 0) / Math.max(1, total),
    avgCostUsd: results.reduce((s, r) => s + (r.cost_usd ?? 0), 0) / Math.max(1, total),
    checkScore: results.reduce((s, r) => s + r.checkScore, 0) / Math.max(1, total),
  };
}

/**
 * The harness rows use Jovian's scoreVersion — the same aggregation the gate uses — scoped to this
 * batch's board ids, so cost is every run under those boards (every coder attempt, every critic call),
 * not just the last attempt's coder cost.
 */
async function harnessRow(setup: string, config: HarnessConfig, results: RunBoardResult[]): Promise<Row> {
  const boardIds = results.map((r) => r.boardId).filter(Boolean);
  const scores = await scoreVersion(config.version, { boardIds });
  if (!scores) throw new Error(`${setup}: no runs found for v${config.version} (boardIds: ${boardIds.join(", ")})`);
  return {
    setup,
    harnessVersion: config.version,
    checksPassed: Math.round(scores.checks_passed * scores.boards),
    total: scores.boards,
    avgAttempts: scores.attempts_per_board,
    avgCostUsd: scores.cost_per_board_usd,
    checkScore: scores.check_score,
  };
}

function printTable(rows: Row[]) {
  const quality = (q?: QualityComparison) =>
    !q ? "" : q.ratio === null ? "no shared spec" : `${q.ratio >= 1 ? "+" : "−"}${(Math.abs(q.ratio - 1) * 100).toFixed(0)}% (${q.shared} specs)`;
  console.log("\n| Setup | Checks passed | Partial credit | Attempts per board | Cost per board | Board quality vs v0 |");
  console.log("|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.setup} | ${r.checksPassed}/${r.total} | ${(r.checkScore * 100).toFixed(0)}% | ${r.avgAttempts.toFixed(2)} | $${r.avgCostUsd.toFixed(4)} | ${quality(r.qualityVsV0)} |`,
    );
  }
}

async function storeRows(rows: Row[]) {
  const ts = new Date().toISOString();
  await col.ablations.insertMany(
    rows.map((r) => ({
      setup: r.setup,
      harness_version: r.harnessVersion,
      checks_passed: r.checksPassed,
      total: r.total,
      avg_attempts: r.avgAttempts,
      avg_cost_usd: r.avgCostUsd,
      check_score: r.checkScore,
      ...(r.qualityVsV0 && { quality_vs_v0: r.qualityVsV0 }),
      ts,
    })),
  );
}

async function main() {
  console.log(`Held-out specs: ${HELD_OUT.join(", ")}`);

  const vN = await currentConfig();
  if (vN.version === 0) console.warn("note: no evolved config has been kept yet, so the vN row runs v0's config (with learned memory)");

  console.log("\nRunning: bare model, no harness...");
  const bare = await Promise.all(HELD_OUT.map((id) => runBareModel(id, vN)));

  // v0 is "loop + checks": baseline config and no learned memory (no lessons, no library subcircuits).
  console.log("Running: harness v0 (no memory)...");
  const v0Results = await runBatch(HELD_OUT, BASELINE, { writeMemory: false, useMemory: false });

  console.log("Running: harness vN (evolved)...");
  const vNResults = await runBatch(HELD_OUT, vN, { writeMemory: false });

  const ids = (rs: RunBoardResult[]) => rs.map((r) => r.boardId).filter(Boolean);
  const vNRow = await harnessRow(`Harness v${vN.version} (evolved config, library, lessons)`, vN, vNResults);
  vNRow.qualityVsV0 = qualityVsParent(
    await specQuality(vN.version, { boardIds: ids(vNResults) }),
    await specQuality(BASELINE.version, { boardIds: ids(v0Results) }),
  );
  const rows = [bareRow("Bare model, no harness", bare), await harnessRow("Harness v0", BASELINE, v0Results), vNRow];

  printTable(rows);
  await storeRows(rows);
  await client.close();
}

main().catch(async (err) => {
  console.error(err);
  await client.close();
  process.exit(1);
});
