// The recursive-harnessing loop: run a batch under the current config, let the meta-agent propose one change,
// let the config gate test it on a fresh batch and keep it, roll it back, or reject it.
//   npm run evolve                              1 round on every training spec
//   npm run evolve -- --rounds 3                several rounds
//   npm run evolve -- --specs t01_led_indicator,t02_...
// Training specs only: held-out specs are for the ablation. Costs model money (coder cheap, critic/meta per routing).
import specs from "../specs/specs.json" with { type: "json" };
import type { HarnessConfig } from "@ripple/types";
import { client, connect } from "../apps/worker/src/db.ts";
import { currentConfig } from "../apps/worker/src/harness/config.ts";
import { evaluatePending } from "../apps/worker/src/harness/gate.ts";

interface BatchResult {
  boardId: string;
  runResult: { passed: boolean; cost_usd?: number };
}
// Loaded dynamically for the same reason as scripts/ablation.ts: scripts/tsconfig.json can't statically walk tscircuit.
const { runBatch } = (await import(new URL("../apps/worker/src/agents/coder-loop.ts", import.meta.url).href)) as {
  runBatch: (specIds: string[], config: HarnessConfig) => Promise<BatchResult[]>;
};
const { proposeFromBatch } = (await import(new URL("../apps/worker/src/agents/meta.ts", import.meta.url).href)) as {
  proposeFromBatch: (results: BatchResult[], config: HarnessConfig) => Promise<HarnessConfig | null>;
};

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TRAIN = (specs as { _id: string; split: string }[]).filter((s) => s.split === "train").map((s) => s._id);
const specIds = arg("--specs")?.split(",") ?? TRAIN;
const rounds = Number(arg("--rounds") ?? 1);
const heldOut = specIds.filter((id) => !TRAIN.includes(id));
if (heldOut.length) throw new Error(`not training specs: ${heldOut.join(", ")}`);

const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const ids = (rs: BatchResult[]) => rs.map((r) => r.boardId).filter(Boolean);
const summary = (rs: BatchResult[]) =>
  `${rs.filter((r) => r.runResult.passed).length}/${rs.length} passed, $${rs.reduce((s, r) => s + (r.runResult.cost_usd ?? 0), 0).toFixed(4)}`;

/** Paths that differ between two configs, e.g. "context.lessons_k: 5 → 3". */
function diff(a: unknown, b: unknown, path = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) =>
      diff((a as any)[k], (b as any)[k], path ? `${path}.${k}` : k),
    );
  }
  return [`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
}
const CONFIG_KEYS = ["rules", "context", "tools", "workflow", "routing"] as const;
const pick = (c: HarnessConfig) => Object.fromEntries(CONFIG_KEYS.map((k) => [k, c[k]]));

await connect();
log(`evolve: ${rounds} round(s) on ${specIds.length} training specs`);
for (let round = 1; round <= rounds; round++) {
  const current = await currentConfig();
  log(`round ${round}: batch under v${current.version}`);
  const batch = await runBatch(specIds, current);
  log(`  v${current.version}: ${summary(batch)}`);

  const proposal = await proposeFromBatch(batch, current);
  if (!proposal) {
    log("  meta-agent: no clear repeated problem, no change proposed");
    continue;
  }
  log(`  meta-agent proposed v${proposal.version}: ${proposal.rationale}`);
  for (const line of diff(pick(current), pick(proposal))) log(`    ${line}`);

  const decision = await evaluatePending(
    async (config) => {
      log(`  gate: test batch under v${config.version}`);
      return { boardIds: ids(await runBatch(specIds, config)) };
    },
    { parentBoardIds: ids(batch) },
  );
  if (decision) log(`  gate: v${decision.version} ${decision.verdict.toUpperCase()}: ${decision.reasons.join("; ")}`);
}
const final = await currentConfig();
log(`current config: v${final.version} (${final.rules.length} rules)`);
await client.close();
