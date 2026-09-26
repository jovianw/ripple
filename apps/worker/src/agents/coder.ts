// Coder agent: spec + context -> tscircuit TSX -> CircuitJson -> DRC/metrics.
// One-shot generation, no retry/repair loop (that's the critic's job, not
// built yet). No hidden-check calls, no Mongo writes, no lesson writing.
import type { HarnessConfig, Lesson, ModelTier, Subcircuit } from "@ripple/types";
import type { CircuitJson } from "tscircuit";
import { callModel, type ChatMessage } from "../tools/router.js";
import { evaluateCircuitSource } from "../tools/evaluate.js";
import { EvaluateError } from "../tools/evaluate.js";
import { runDrc, type DrcResult } from "../tools/drc.js";
import { computeMetrics, MetricsError, type CircuitMetrics } from "../tools/metrics.js";
import { partsWhitelistPrompt } from "../tools/parts-whitelist.js";

export interface CoderInput {
  specText: string;
  config: HarnessConfig;
  lessons?: Lesson[];
  subcircuits?: Subcircuit[];
  previousFailure?: string;
  /** A passing design to make smaller and cleaner (the optimize pass). Replaces previousFailure. */
  optimizeFrom?: { source: string; metrics: CircuitMetrics; circuitJson: CircuitJson };
}

type El = CircuitJson[number];

/** The rendered board's size and where the placer put each part, for the optimize prompt. */
function placement(circuitJson: CircuitJson): { board: { width: number; height: number }; parts: string[] } {
  const board = circuitJson.find((e): e is Extract<El, { type: "pcb_board" }> => e.type === "pcb_board");
  if (!board || typeof board.width !== "number" || typeof board.height !== "number") throw new Error("optimizeFrom: no sized pcb_board");
  const names = new Map(
    circuitJson
      .filter((e): e is Extract<El, { type: "source_component" }> => e.type === "source_component")
      .map((c) => [c.source_component_id, c.name]),
  );
  const parts = circuitJson
    .filter((e): e is Extract<El, { type: "pcb_component" }> => e.type === "pcb_component")
    .map((c) => {
      const name = names.get(c.source_component_id);
      if (!name) throw new Error(`optimizeFrom: pcb_component ${c.pcb_component_id} has no source component`);
      return `- ${name}: (${c.center.x.toFixed(1)}, ${c.center.y.toFixed(1)}); ${c.width.toFixed(1)} x ${c.height.toFixed(1)}`;
    });
  return { board: { width: board.width, height: board.height }, parts };
}

export interface CoderModelInfo {
  model: string;
  tier: ModelTier;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface CoderResult {
  source: string;
  circuitJson: CircuitJson;
  drc: DrcResult;
  metrics: CircuitMetrics;
  model: CoderModelInfo;
}

const SYSTEM_PROMPT = `You write tscircuit TSX source for printed circuit boards.

Output ONLY valid tscircuit TSX source code. No markdown, no code fences, no
explanations, no comments outside the code. Your entire response must be
exactly one TSX module with this shape:

export default () => (
  <board>
    ...
  </board>
)

Use only tscircuit's built-in JSX components (e.g. <board>, <resistor>,
<capacitor>, <chip>, <trace>, <led>...). Do not import any npm package. Do
not invent components or props that do not exist in tscircuit.

You may ONLY use parts from the whitelist below — no other manufacturer
part numbers, footprints, or invented components. Parts outside the
whitelist will fail the design checks.

${partsWhitelistPrompt()}

Every component needs a unique "name" prop (e.g. name="R1"). Use the
component's real value prop: resistors take "resistance" (e.g.
resistance="1k"), capacitors take "capacitance" (e.g.
capacitance="1000pF") — never a generic "value" prop. Reference a
component's pin in a trace with a dot-prefixed selector built from its
name, e.g. ".R1 > .pin1", never the bare component name.

Example of a correct, complete module:

export default () => (
  <board>
    <resistor name="R1" resistance="1k" footprint="0402" />
    <capacitor name="C1" capacitance="1000pF" footprint="0402" />
    <trace from=".R1 > .pin1" to=".C1 > .pin1" />
  </board>
)`;

function buildUserPrompt(input: CoderInput): string {
  const parts: string[] = [];

  parts.push(`Spec:\n${input.specText}`);

  if (input.config.rules.length > 0) {
    parts.push(`Rules (must follow):\n${input.config.rules.map((r) => `- ${r}`).join("\n")}`);
  }

  if (input.lessons && input.lessons.length > 0) {
    const lessonText = input.lessons
      .map((l) => `- pattern: ${l.pattern}\n  fix: ${l.fix}`)
      .join("\n");
    parts.push(`Lessons from past failures (apply these):\n${lessonText}`);
  }

  if (input.subcircuits && input.subcircuits.length > 0) {
    const subcircuitText = input.subcircuits
      .map((s) => `// ${s.name}\n${s.code}`)
      .join("\n\n");
    parts.push(`Verified subcircuits available for reuse:\n${subcircuitText}`);
  }

  if (input.optimizeFrom) {
    const { source, metrics: m, circuitJson } = input.optimizeFrom;
    const { board, parts: placed } = placement(circuitJson);
    parts.push(`This design already passes every check:

${source}

It rendered as a ${board.width.toFixed(1)} x ${board.height.toFixed(1)} mm board (${m.area_mm2.toFixed(0)} mm², parts cover ${(m.density * 100).toFixed(0)}% of it, routing ${m.detour.toFixed(2)}x the straight-line length, ${m.vias} vias), with parts at (centre x, y; footprint width x height, mm; board centre is 0,0):
${placed.join("\n")}

Now make it a better board without changing any part, footprint, value or connection:
- start from that placement and write it out: pcbX/pcbY on every part, and an explicit <board width height> about 25% smaller in area than ${board.width.toFixed(1)} x ${board.height.toFixed(1)} mm (not more: a board that fails any check is thrown away)
- pull parts closer together, keeping at least 1mm between footprints and 2mm around headers and connectors (courtyards are larger than the footprint and must not overlap), and every part inside the board with 1mm to spare
- short, direct routes and fewer vias: put connected parts next to each other`);
  } else if (input.previousFailure) {
    parts.push(`Previous attempt failed with:\n${input.previousFailure}\nFix this in the new version.`);
  }

  return parts.join("\n\n");
}

function extractSource(content: string): string {
  const fenced = content.match(/```(?:tsx|jsx|ts|js)?\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : content).trim();
}

/** The model's code didn't compile or render. Carries the code and the call's cost so the loop can record the attempt and hand the code to the critic. */
export class CoderCompileError extends Error {
  constructor(message: string, readonly source: string, readonly model: CoderModelInfo, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CoderCompileError";
  }
}

export async function runCoder(input: CoderInput): Promise<CoderResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(input) },
  ];

  const routerResult = await callModel({ role: "coder", messages, config: input.config });
  const source = extractSource(routerResult.content);

  const model: CoderModelInfo = {
    model: routerResult.model,
    tier: routerResult.tier,
    promptTokens: routerResult.promptTokens,
    completionTokens: routerResult.completionTokens,
    totalTokens: routerResult.totalTokens,
    costUsd: routerResult.costUsd,
  };

  let circuitJson: CircuitJson;
  try {
    ({ circuitJson } = await evaluateCircuitSource(source));
  } catch (err) {
    if (!(err instanceof EvaluateError)) throw err;
    const cause = err.cause instanceof Error ? err.cause.message : String(err.cause ?? "");
    throw new CoderCompileError(`code did not compile or render: ${cause || err.message}`.slice(0, 500), source, model, { cause: err });
  }
  const drc = runDrc(circuitJson);
  let metrics: CircuitMetrics;
  try {
    metrics = computeMetrics(circuitJson);
  } catch (err) {
    if (!(err instanceof MetricsError)) throw err;
    throw new CoderCompileError(err.message, source, model, { cause: err });
  }

  return { source, circuitJson, drc, metrics, model };
}
