// Local verification for coder.ts. Not part of the public API.
// Uses the real OpenRouter API — requires OPENROUTER_API_KEY.
// Run after `npm run typecheck`: node apps/worker/dist/agents/coder.verify.js
import type { HarnessConfig } from "@board-forge/types";
import { runCoder } from "./coder.js";

const config: HarnessConfig = {
  version: 1,
  parent: null,
  rules: ["Prefer simple, well-known parts with standard footprints."],
  context: { subcircuits_k: 0, lessons_k: 0, rerank: false, include_last_failure: false },
  tools: {
    route_requires_connectivity: false,
    parts_whitelist: "v1",
    mcp: { planner: [], coder: [], critic: [], meta: [] },
  },
  workflow: { plan_first: false, repair_budget: 0, split_over_parts: 12 },
  routing: { planner: "strong", coder: "cheap", critic: "strong", meta: "strong" },
  verdict: "pending",
  rationale: "coder.ts verification run",
};

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set. Not mocking the model — stopping.");
    process.exit(1);
  }

  const result = await runCoder({
    specText: "Create a tiny board with a resistor and capacitor connected by a trace.",
    config,
  });

  const routerOk = result.circuitJson.length > 0;
  const drcOk = result.drc.passed && result.drc.errors.length === 0;
  const traceLengthPositive = result.metrics.trace_mm > 0;
  const ok = routerOk && drcOk && traceLengthPositive;

  console.log(
    JSON.stringify(
      {
        source: result.source,
        elementCount: result.circuitJson.length,
        drc: result.drc,
        metrics: result.metrics,
        model: result.model,
        routerOk,
        drcOk,
        traceLengthPositive,
        ok,
      },
      null,
      2,
    ),
  );

  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
