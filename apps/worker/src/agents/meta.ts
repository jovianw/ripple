// Meta-agent: reads a batch's RunResults, proposes a HarnessConfig change
// via Jovian's propose(). Never applies anything itself — the config gate
// (Jovian's evaluatePending) tests the proposal on the next batch and
// decides keep/roll back/reject.
import type { HarnessConfig } from "@ripple/types";
import { createComplete, type JsonSchema } from "../tools/router.js";
import { propose, type ConfigChange } from "../harness/config.js";
import type { RunBoardResult } from "./coder-loop.js";

export const META_SYSTEM = `You are the meta-agent in Ripple, a harness that designs printed circuit boards.
You read the results of a batch of boards run under the current harness config and propose ONE change to
that config to raise the pass rate, lower attempts per board, or lower cost — without weakening any check.

Rules:
- Propose the smallest change that addresses the most common failure pattern in the batch. If the batch shows
  no clear, repeated problem, set "change" to false and every other field to null.
- "rules" is the COMPLETE new rule list if you change it (existing rules you want to keep, plus new ones),
  not just additions. Set it to null to leave rules unchanged.
- For context/tools/workflow/routing, set a field to null to leave it unchanged; only set fields you are
  changing.
- Routing only ever names "cheap" or "strong". Moving an agent from cheap to strong costs money; only do it
  if the batch shows the cheap model is causing repeated failures that tier would fix.
- Never propose a change that would let a board skip or bypass a check (e.g. turning off
  route_requires_connectivity is only for loosening an over-strict gate, never for hiding a real failure).

Reply with JSON only, matching the schema.`;

export const META_SCHEMA: JsonSchema = {
  name: "meta",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["change", "rationale", "rules", "context", "tools", "workflow", "routing"],
    properties: {
      change: { type: "boolean", description: "false when the batch shows no clear, repeated problem worth a config change" },
      rationale: { type: "string", description: "One or two sentences: what pattern in the batch this addresses" },
      rules: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "Complete new rule list, or null to leave unchanged",
      },
      context: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["subcircuits_k", "lessons_k", "rerank", "include_last_failure"],
        properties: {
          subcircuits_k: { type: ["integer", "null"] },
          lessons_k: { type: ["integer", "null"] },
          rerank: { type: ["boolean", "null"] },
          include_last_failure: { type: ["boolean", "null"] },
        },
      },
      tools: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["route_requires_connectivity"],
        properties: {
          route_requires_connectivity: { type: ["boolean", "null"] },
        },
      },
      workflow: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["plan_first", "repair_budget", "split_over_parts"],
        properties: {
          plan_first: { type: ["boolean", "null"] },
          repair_budget: { type: ["integer", "null"] },
          split_over_parts: { type: ["integer", "null"] },
        },
      },
      routing: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["planner", "coder", "critic", "meta"],
        properties: {
          planner: { anyOf: [{ type: "string", enum: ["cheap", "strong"] }, { type: "null" }] },
          coder: { anyOf: [{ type: "string", enum: ["cheap", "strong"] }, { type: "null" }] },
          critic: { anyOf: [{ type: "string", enum: ["cheap", "strong"] }, { type: "null" }] },
          meta: { anyOf: [{ type: "string", enum: ["cheap", "strong"] }, { type: "null" }] },
        },
      },
    },
  },
};

interface MetaRawOutput {
  change: boolean;
  rationale: string;
  rules: string[] | null;
  context: Record<string, unknown> | null;
  tools: Record<string, unknown> | null;
  workflow: Record<string, unknown> | null;
  routing: Record<string, unknown> | null;
}

/** Drops null-valued keys so a spread merge doesn't overwrite a real value with null. */
function stripNulls<T extends object>(obj: Record<string, unknown> | null): Partial<T> | undefined {
  if (!obj) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null) out[k] = v;
  return out as Partial<T>;
}

function toConfigChange(raw: MetaRawOutput): ConfigChange {
  return {
    rules: raw.rules ?? undefined,
    context: stripNulls(raw.context),
    tools: stripNulls(raw.tools),
    workflow: stripNulls(raw.workflow),
    routing: stripNulls(raw.routing),
  };
}

function summarizeBatch(results: RunBoardResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.runResult.passed).length;
  const avgAttempts = results.reduce((s, r) => s + r.attempts, 0) / Math.max(1, total);
  const avgCost = results.reduce((s, r) => s + (r.runResult.cost_usd ?? 0), 0) / Math.max(1, total);

  const failureCounts = new Map<string, number>();
  for (const r of results) {
    for (const f of r.runResult.failures) failureCounts.set(f.check, (failureCounts.get(f.check) ?? 0) + 1);
  }
  const failureLines = [...failureCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([check, n]) => `- ${check}: ${n}/${total} boards`);

  const escalations = results.flatMap((r) => r.criticResults.filter((c) => c.escalate).map((c) => c.escalate_reason));

  return `## Batch results
${passed}/${total} boards passed. Average attempts per board: ${avgAttempts.toFixed(2)}. Average cost per board: $${avgCost.toFixed(4)}.

## Failure counts (by check, most common first)
${failureLines.length ? failureLines.join("\n") : "(none — every board passed)"}

## Critic escalations (fix needed a different architecture, not just a retry)
${escalations.length ? escalations.map((r) => `- ${r}`).join("\n") : "(none)"}`;
}

/** True when the change would leave the config exactly as it is. */
function isNoOp(change: ConfigChange, config: HarnessConfig): boolean {
  if (change.rules && JSON.stringify(change.rules) !== JSON.stringify(config.rules)) return false;
  for (const section of ["context", "tools", "workflow", "routing"] as const) {
    const fields = (change[section] ?? {}) as Record<string, unknown>;
    const current = config[section] as Record<string, unknown>;
    for (const [k, v] of Object.entries(fields)) if (JSON.stringify(current[k]) !== JSON.stringify(v)) return false;
  }
  return true;
}

/**
 * Proposes a config change from a batch's results, or returns null when there's nothing worth changing
 * (so the gate doesn't spend a batch scoring a no-op). Doesn't run the batch itself — pass runBatch's output.
 */
export async function proposeFromBatch(results: RunBoardResult[], config: HarnessConfig): Promise<HarnessConfig | null> {
  const complete = createComplete("meta", config);
  const raw = (await complete(META_SYSTEM, summarizeBatch(results), META_SCHEMA)) as MetaRawOutput;
  const change = toConfigChange(raw);
  if (!raw.change || isNoOp(change, config)) return null;
  return propose(change, raw.rationale);
}
