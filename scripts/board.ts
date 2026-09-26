// Runs one spec through the single-board loop and narrates it: each attempt's hidden-check failures and partial
// credit, the critic's diagnosis and the lessons it stored, the lessons retrieved from memory, and what the optimize
// pass did to the passing board. Demo segment 1 from the CLI.
//   npm run board -- t04_i2c_temp_breakout
//   npm run board -- t04_i2c_temp_breakout --no-memory   (run as if memory were empty, to show a first failure)
import specs from "../specs/specs.json" with { type: "json" };
import type { HarnessConfig, RunResult } from "@ripple/types";
import { client, col, connect } from "../apps/worker/src/db.ts";
import { currentConfig } from "../apps/worker/src/harness/config.ts";

interface Critic {
  diagnosis: { check: string; cause: string }[];
  fix: string[];
  saved_lesson_ids: string[];
  lessons: { pattern: string; fix: string }[];
}
// Dynamic import: scripts/tsconfig.json can't statically walk tscircuit (same as scripts/ablation.ts).
const { runBoard } = (await import(new URL("../apps/worker/src/agents/coder-loop.ts", import.meta.url).href)) as {
  runBoard: (specId: string, config: HarnessConfig, opts: { useMemory?: boolean; writeMemory?: boolean }) =>
    Promise<{ boardId: string; attempts: number; runResult: RunResult; criticResults: Critic[]; optimize?: Optimize }>;
};

interface Quality { area_mm2: number; density: number; detour: number; vias: number; parts: number; bom_usd: number }
interface Optimize { adopted: boolean; ratio: number | null; before: Quality; after?: Quality; failures: { check: string; detail: string }[] }
const describe = (q: Quality) =>
  `${q.area_mm2.toFixed(0)} mm² (parts cover ${(q.density * 100).toFixed(0)}%), routing ${q.detour.toFixed(2)}x straight-line, ${q.vias} vias, ${q.parts} parts, BOM $${q.bom_usd.toFixed(2)}`;

const specId = process.argv[2];
const spec = (specs as { _id: string; split: string; text: string }[]).find((s) => s._id === specId);
if (!spec) {
  console.error(`usage: npm run board -- <spec_id>   (one of: ${(specs as { _id: string }[]).map((s) => s._id).join(", ")})`);
  process.exit(1);
}
const useMemory = !process.argv.includes("--no-memory");

await connect();
const config = await currentConfig();
console.log(`\nSPEC ${spec._id} (${spec.split}): ${spec.text}`);
console.log(`harness v${config.version}: ${config.rules.length} rules, repair budget ${config.workflow.repair_budget}, memory ${useMemory ? "on" : "off"}\n`);

const r = await runBoard(spec._id, config, { useMemory, writeMemory: spec.split === "train" });

const runs = await col.runs.find({ board_id: r.boardId }, { sort: { ts: 1 }, projection: { embedding: 0 } }).toArray();
const graded = runs.filter((x) => x.stage === "checks" || x.stage === "compile" || x.stage === "error");
graded.forEach((run, i) => {
  const partial = run.check_score === undefined ? "" : `, partial credit ${(run.check_score * 100).toFixed(0)}%`;
  console.log(`attempt ${i + 1}: ${run.passed ? "PASSED all hidden checks" : `failed ${run.failures.length} check(s)`}${partial}`);
  for (const f of run.failures.slice(0, 6)) console.log(`   ✗ ${f.check}: ${f.detail.slice(0, 110)}`);
  if (run.failures.length > 6) console.log(`   … ${run.failures.length - 6} more`);
  const used = (run as { lessons_used?: string[] }).lessons_used ?? [];
  if (used.length) console.log(`   lessons in context: ${used.length}`);
  const c = r.criticResults[i];
  if (c && !run.passed) {
    for (const d of c.diagnosis.slice(0, 3)) console.log(`   critic: ${d.check}: ${d.cause.slice(0, 110)}`);
    for (const l of c.lessons.slice(0, 3)) console.log(`   lesson: ${l.pattern} → ${l.fix.slice(0, 90)}`);
  }
});
if (r.optimize) {
  const o = r.optimize;
  console.log(`
optimize pass: ${o.adopted ? "ADOPTED" : "not adopted"}${o.ratio === null ? "" : `, ${o.ratio >= 1 ? "+" : "−"}${(Math.abs(o.ratio - 1) * 100).toFixed(0)}% board quality`}`);
  console.log(`   before: ${describe(o.before)}`);
  if (o.after) console.log(`   after:  ${describe(o.after)}`);
  for (const f of o.failures.slice(0, 3)) console.log(`   ✗ ${f.check}: ${f.detail.slice(0, 110)}`);
}
const cost = runs.reduce((s, x) => s + (x.cost_usd ?? 0), 0);
console.log(`\n${r.runResult.passed ? "PASSED" : "did not pass"} in ${r.attempts} attempt(s), $${cost.toFixed(4)}; board ${r.boardId}`);
await client.close();
