// Ablation: same model, held-out specs, three harness conditions (DESIGN.md §7).
//   npm run ablation
// Needs OPENROUTER_API_KEY, VOYAGE_API_KEY, MONGODB_URI. writeMemory: false
// throughout — held-out solutions never enter the subcircuit/lesson library.
import specs from "../specs/specs.json" with { type: "json" };
import { client } from "../apps/worker/src/db.ts";
import { BASELINE, currentConfig } from "../apps/worker/src/harness/config.ts";
import { callModel } from "../apps/worker/src/tools/router.ts";
import type { HarnessConfig, RunResult } from "@ripple/types";

// Structural subset of coder-loop.ts's RunBoardResult — not imported as a type
// because even `import type` walks the source file for resolution, which
// hits the same tscircuit/fanout-solver problem as a value import (see below).
interface RunBoardResult {
  runResult: RunResult;
  attempts: number;
}

// coder-loop.ts and evaluate.ts both reach "tscircuit", which scripts/tsconfig.json's
// plain NodeNext resolution can't statically walk (see apps/worker/tsconfig.json's
// moduleResolution/paths for the full story). Load them dynamically, like
// green-check.ts does for db.ts and coder-loop.ts does for checks/index.ts.
const { runBatch, findSpec } = (await import(new URL("../apps/worker/src/agents/coder-loop.ts", import.meta.url).href)) as {
  runBatch: (specIds: string[], config: HarnessConfig, opts?: { writeMemory?: boolean }) => Promise<RunBoardResult[]>;
  findSpec: (id: string) => { text: string };
};
const { evaluateCircuitSource } = (await import(new URL("../apps/worker/src/tools/evaluate.ts", import.meta.url).href)) as {
  evaluateCircuitSource: (source: string) => Promise<{ circuitJson: unknown }>;
};

const HELD_OUT = (specs as { _id: string; split: string }[]).filter((s) => s.split === "held_out").map((s) => s._id);

interface Row {
  setup: string;
  checksPassed: number;
  total: number;
  avgAttempts: number;
  avgCostUsd: number;
}

function toRow(setup: string, results: { passed: boolean; attempts: number; cost_usd?: number }[]): Row {
  const total = results.length;
  return {
    setup,
    checksPassed: results.filter((r) => r.passed).length,
    total,
    avgAttempts: results.reduce((s, r) => s + r.attempts, 0) / Math.max(1, total),
    avgCostUsd: results.reduce((s, r) => s + (r.cost_usd ?? 0), 0) / Math.max(1, total),
  };
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
  };

  let passed = false;
  const cost_usd = routerResult.costUsd;
  try {
    const { circuitJson } = await evaluateCircuitSource(source);
    const result = await checks.runChecks(circuitJson, checks.loadExpected(specId));
    passed = result.passed;
  } catch {
    passed = false; // bare model with no whitelist/shape guidance often produces code that won't even evaluate
  }
  return { passed, attempts: 1, cost_usd };
}

async function runBareBatch(specIds: string[], config: HarnessConfig) {
  return Promise.all(specIds.map((id) => runBareModel(id, config)));
}

function boardRowInput(results: RunBoardResult[]) {
  return results.map((r) => ({ passed: r.runResult.passed, attempts: r.attempts, cost_usd: r.runResult.cost_usd }));
}

function printTable(rows: Row[]) {
  console.log("\n| Setup | Checks passed | Attempts per board | Cost per board |");
  console.log("|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.setup} | ${r.checksPassed}/${r.total} | ${r.avgAttempts.toFixed(2)} | $${r.avgCostUsd.toFixed(4)} |`,
    );
  }
}

async function main() {
  console.log(`Held-out specs: ${HELD_OUT.join(", ")}`);

  const vN = await currentConfig();

  console.log("\nRunning: bare model, no harness...");
  const bare = await runBareBatch(HELD_OUT, vN);

  console.log("Running: harness v0...");
  const v0Results = await runBatch(HELD_OUT, BASELINE, { writeMemory: false });

  console.log("Running: harness vN (evolved)...");
  const vNResults = await runBatch(HELD_OUT, vN, { writeMemory: false });

  const rows = [
    toRow("Bare model, no harness", bare),
    toRow(`Harness v0`, boardRowInput(v0Results)),
    toRow(`Harness v${vN.version} (evolved)`, boardRowInput(vNResults)),
  ];

  printTable(rows);
  await client.close();
}

main().catch(async (err) => {
  console.error(err);
  await client.close();
  process.exit(1);
});
