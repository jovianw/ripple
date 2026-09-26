// Critic, improve mode. Owner: Marcos (critic); improve mode added by Jovian.
// Runs on a board that PASSED every hidden check: reviews it for size, routing and cost, and tells the coder the
// few edits that would make it a better board. The loop keeps the edited board only if it still passes and scores
// better (harness/quality.ts boardRatio); otherwise the passing board stands. No lessons: a lesson is written from
// a failure, and a size suggestion that didn't pan out isn't one.
import type { Spec } from "@ripple/types"
import type { RunQuality } from "../../harness/quality.js"
import { courtyards } from "../../tools/placement.js"
import { describeLayout } from "./layout.js"
import { compactWhitelist } from "./prompt.js"

export const IMPROVE_SYSTEM = `You are the critic in Ripple, a harness that designs printed circuit boards in tscircuit.
This board already PASSES every hidden check. Your job now is to make it a better board: smaller, with shorter,
more direct routing, fewer vias, and a cheaper bill of materials, without breaking anything that passes.

Give the coder a short list of concrete edits (at most 6), most valuable first:
- Board size is not your edit: after your edits the harness sizes the board to wrap the parts' courtyards with
  1.5mm on every side, centred. So the board shrinks exactly as much as you pull the parts together ("Parts span"
  is the area they cover now). Don't give <board> a width or height.
- Placement: move parts closer together into a compact block, keeping at least 0.5mm between courtyards (use
  "Layout": courtyards and pad positions are in mm). Put parts that connect next to each other; a rotation
  (pcbRotation={90}) often packs a long part better. Give exact pcbX/pcbY (and pcbRotation if you rotate) for every
  part you move. Don't move a decoupling capacitor away from the chip pin it serves: it must stay within 3mm of that
  pad.
- Parts: a cheaper or smaller part from the whitelist is fine only if it does exactly the same job (same element,
  same value, e.g. a 0805 resistor to a 0603 one). Never change a value, add or remove a part, or change a header's
  pin labels.
- Never add trace constraints (maxLength, trace widths) or edit traces: the autorouter handles routing.
- Refer to parts by the names in the code. Positions and sizes in mm, written as pcbX={12}, width="20mm".
If the board is already tight and cheap, return no edits: an edit that doesn't help costs a rebuild.

Reply with JSON only, matching the schema.`

export const IMPROVE_SCHEMA = {
  name: "improve",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["edits", "expected"],
    properties: {
      edits: { type: "array", items: { type: "string" }, maxItems: 6, description: "Ordered edits for the coder; empty if the board is already good" },
      expected: { type: "string", description: "One sentence: what these edits should gain (e.g. 'board from 12x13mm to 9x8mm')" },
    },
  },
} as const

export interface ImproveInput {
  spec: Pick<Spec, "_id" | "text">
  /** The passing board's code, with every part pinned where it rendered (bakePlacement). */
  code: string
  circuitJson: unknown
  metrics: RunQuality
  rules: string[]
  /** The previous round's edits to this same board, which were discarded, and why. */
  lastTry?: { edits: string[]; outcome: string }
}

export interface ImproveOutput {
  edits: string[]
  expected: string
}

export interface ImproveDeps {
  /** Calls the critic's model with a JSON schema; returns the parsed JSON. */
  complete(system: string, user: string, schema: typeof IMPROVE_SCHEMA): Promise<unknown>
}

type El = { type: string; [k: string]: any }
const mm = (v: number) => v.toFixed(1)

export function improveUserPrompt(input: ImproveInput): string {
  const els = (Array.isArray(input.circuitJson) ? input.circuitJson : []) as El[]
  const board = els.find((e) => e.type === "pcb_board")
  if (!board || typeof board.width !== "number" || typeof board.height !== "number") throw new Error("improve: no sized pcb_board")
  const boxes = [...courtyards(els).values()]
  if (!boxes.length) throw new Error("improve: no part courtyards")
  const x0 = Math.min(...boxes.map((b) => b.x0)), x1 = Math.max(...boxes.map((b) => b.x1))
  const y0 = Math.min(...boxes.map((b) => b.y0)), y1 = Math.max(...boxes.map((b) => b.y1))
  const m = input.metrics
  return `## Spec
${input.spec.text}

## This board (passes every hidden check)
Board: ${mm(board.width)} x ${mm(board.height)} mm (${m.area_mm2.toFixed(0)} mm²); parts cover ${(m.density * 100).toFixed(0)}% of it.
Parts span (courtyards): x ${mm(x0)}..${mm(x1)}, y ${mm(y0)}..${mm(y1)} = ${mm(x1 - x0)} x ${mm(y1 - y0)} mm.
Routing: ${m.trace_mm.toFixed(1)} mm of trace for ${m.connections} connections, ${m.detour.toFixed(2)}x the straight-line length; ${m.vias} vias.
Parts: ${m.parts}; BOM $${m.bom_usd.toFixed(3)}.

${input.lastTry ? `## Your last edits to this board were discarded
${input.lastTry.edits.map((e) => `- ${e}`).join("\n")}
Result: ${input.lastTry.outcome}
Don't repeat them: fix what broke (for example, parts packed so tightly their courtyards overlap), or suggest
something else.

` : ""}## Harness rules (keep following them)
${input.rules.length ? input.rules.map((r) => `- ${r}`).join("\n") : "(none)"}

## Parts (whitelist; unit price in brackets)
${compactWhitelist()}

## Layout
${describeLayout(input.circuitJson)}

## Board code
\`\`\`tsx
${input.code}
\`\`\``
}

export async function runImprover(input: ImproveInput, deps: ImproveDeps): Promise<ImproveOutput> {
  const raw = (await deps.complete(IMPROVE_SYSTEM, improveUserPrompt(input), IMPROVE_SCHEMA)) as Partial<ImproveOutput>
  return { edits: (raw.edits ?? []).slice(0, 6), expected: raw.expected ?? "" }
}
