// Coder agent: spec + context -> tscircuit TSX -> CircuitJson -> DRC/metrics.
// One-shot generation, no retry/repair loop (that's the critic's job, not
// built yet). No hidden-check calls, no Mongo writes, no lesson writing.
import type { HarnessConfig, Lesson, ModelTier, Subcircuit } from "@ripple/types";
import type { CircuitJson } from "tscircuit";
import { callModel, type ChatMessage } from "../tools/router.js";
import { evaluateCircuitSource } from "../tools/evaluate.js";
import { runDrc, type DrcResult } from "../tools/drc.js";
import { computeMetrics, type CircuitMetrics } from "../tools/metrics.js";

export interface CoderInput {
  specText: string;
  config: HarnessConfig;
  lessons?: Lesson[];
  subcircuits?: Subcircuit[];
  previousFailure?: string;
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
Strongly prefer simple, well-known parts and standard footprints (e.g.
0402, 0603) over unusual or exotic ones.

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

  if (input.previousFailure) {
    parts.push(`Previous attempt failed with:\n${input.previousFailure}\nFix this in the new version.`);
  }

  return parts.join("\n\n");
}

function extractSource(content: string): string {
  const fenced = content.match(/```(?:tsx|jsx|ts|js)?\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : content).trim();
}

export async function runCoder(input: CoderInput): Promise<CoderResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(input) },
  ];

  const routerResult = await callModel({ role: "coder", messages, config: input.config });
  const source = extractSource(routerResult.content);

  const { circuitJson } = await evaluateCircuitSource(source);
  const drc = runDrc(circuitJson);
  const metrics = computeMetrics(circuitJson);

  return {
    source,
    circuitJson,
    drc,
    metrics,
    model: {
      model: routerResult.model,
      tier: routerResult.tier,
      promptTokens: routerResult.promptTokens,
      completionTokens: routerResult.completionTokens,
      totalTokens: routerResult.totalTokens,
      costUsd: routerResult.costUsd,
    },
  };
}
