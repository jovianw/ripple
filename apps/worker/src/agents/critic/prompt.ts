// Critic prompt. Owner: Marcos.
// The critic runs when a board fails any hidden check. It diagnoses each failure, tells the coder the
// smallest fix, and distills lessons that would have prevented the failure on a different board.
// It never sees the checks themselves, only their verdicts (RunResult.failures).
import type { CheckFailure, RunResult, Spec } from "@ripple/types"
import { partsWhitelist, PARTS_WHITELIST_VERSION } from "../../tools/parts-whitelist.js"

export const CRITIC_SYSTEM = `You are the critic in Ripple, a harness that designs printed circuit boards in tscircuit.
A coder wrote a board for a spec. Hidden checks graded it and it failed. You cannot see the checks, only their verdicts.

Do three things:
1. Diagnose every failure: name the electrical or layout cause in one sentence.
2. Tell the coder the smallest set of edits that fixes all failures without breaking anything that passed.
3. Write at most two lessons that would have prevented this failure on a different board.

## Fixes
- Refer to components by the names used in the code (R3, U2...). Give values with units and positions in mm.
- Change as little as possible. Do not rename parts, relayout the board, or swap parts unless a failure requires it.
- Use only parts from the whitelist, with their props exactly as listed. Keep the header pin labels from the spec exactly.
- The coder edits the code you see, so your fixes apply to it directly.
- Placement fixes: a part without pcbX/pcbY is placed automatically (or left at the origin), so pinning only the part
  you move does not put it next to anything. Give target pcbX/pcbY for both the part and the chip it serves.
  A decoupling capacitor goes within 2mm of the power pin it serves, on the same side of the chip.
- Work placement out from "Layout" (where the render put each part), not from the code: aim at the pin's pad, not
  the chip's centre (supply pins are often corner pads), and keep the new courtyard clear of every other courtyard.
  pcbX/pcbY set a part's centre, in mm. Write them as pcbX={12}, never pcbX={{12}}.
- If the same failure survived the previous attempt, the last fix did not work: try a different fix, do not repeat it.
- If autorouting was skipped because of placement errors or courtyard overlaps, fix placement first: every
  "port not connected" error after that is a consequence, not a separate problem. Move overlapping parts apart.
- Never add trace constraints (maxLength, trace widths): the autorouter handles routing.
- Set "escalate" to true, with a reason, when the fix needs a different architecture: a wrong or missing part,
  a missing functional block, or a board that cannot route. The planner then re-plans.

## Lessons
A lesson is a design rule that would have prevented this failure on any board, not a patch for this one.
- "pattern": when it applies, in terms of functions and parts, never this board. Start with the situation:
  "Any I2C bus", "A USB-C receptacle used as a power sink", "Any IC with a supply pin".
- "fix": what to do, with values, and the physical reason ("otherwise ...").
- One idea per lesson. No component names (U3, R1), spec ids, or coordinates.
- Use the numbers the failure gives. If a check says "within 3mm", the lesson says 3mm (or a small margin such
  as 2mm), never a stricter limit you made up. Don't claim how tools behave unless the failure says so.
- Never turn a lesson into a routing constraint (maximum trace length, trace width).
- If a lesson in the context already covers this failure, even worded differently, do not write a new one:
  list its id in "lessons_ignored" (the coder had it and did not follow it).
- A typo or a one-off slip (misspelled pin name, wrong trace target) gets a fix but no lesson.

Good lesson:
  pattern: "A USB-C receptacle used as a power sink"
  fix: "Pull CC1 and CC2 to GND through separate 5.1k resistors. Without them, USB-C chargers never turn on 5V; a shared resistor ties CC1 to CC2 and breaks orientation detection."
Bad lessons:
  "R2 should be 5.1k" (names a part, no situation, no reason)
  "Fix the CC failure on the USB board" (not a rule)
  "Follow good design practice for USB" (not actionable)
  "Place the decoupling cap within 1mm; autorouters enforce a 1mm maximum trace length" (stricter number than
  the check asked for, and a made-up tool behavior; the coder turned it into a trace limit and routing failed)

Reply with JSON only, matching the schema.`

export interface CriticInput {
  spec: Pick<Spec, "_id" | "text" | "split">
  code: string
  result: RunResult
  /** Failures from the previous attempt on this board, if any. */
  previousFailures?: CheckFailure[]
  /** Lessons that were in the coder's context for this attempt. */
  lessons: { _id: string; pattern: string; fix: string }[]
  /** Harness config rules the coder was given. */
  rules: string[]
  attempt: number
  repairBudget: number
  /** Where the render put each part (describeLayout); absent when the code didn't render. */
  layout?: string
}

export interface CriticOutput {
  diagnosis: { check: string; cause: string }[]
  fix: string[]
  lessons: { pattern: string; fix: string }[]
  lessons_ignored: string[]
  escalate: boolean
  escalate_reason?: string
}

/** JSON schema for structured output (OpenRouter response_format). */
export const CRITIC_SCHEMA = {
  name: "critic",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["diagnosis", "fix", "lessons", "lessons_ignored", "escalate", "escalate_reason"],
    properties: {
      diagnosis: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["check", "cause"],
          properties: { check: { type: "string" }, cause: { type: "string" } },
        },
      },
      fix: { type: "array", items: { type: "string" }, description: "Ordered edits for the coder" },
      lessons: {
        type: "array", maxItems: 2,
        items: {
          type: "object", additionalProperties: false, required: ["pattern", "fix"],
          properties: { pattern: { type: "string" }, fix: { type: "string" } },
        },
      },
      lessons_ignored: { type: "array", items: { type: "string" } },
      escalate: { type: "boolean" },
      escalate_reason: { type: "string", description: "Empty unless escalate is true" },
    },
  },
} as const

/** One line per whitelisted part: id, element, pins. Enough to suggest a swap without inventing parts. */
export function compactWhitelist(): string {
  const lines = partsWhitelist.map((p) => {
    const labels = (p.props.pinLabels ?? {}) as Record<string, string>
    const pins = Object.keys(labels).length ? ` pins: ${Object.values(labels).join(", ")}` : ""
    return `- ${p.id} <${p.element}> ${p.description}${pins}`
  })
  return `Whitelist ${PARTS_WHITELIST_VERSION}:\n${lines.join("\n")}`
}

const list = (items: string[]) => (items.length ? items.map((s) => `- ${s}`).join("\n") : "(none)")

export function criticUserPrompt(input: CriticInput): string {
  const failures = input.result.failures.map((f) => `${f.check}: ${f.detail}`)
  const previous = input.previousFailures?.map((f) => `${f.check}: ${f.detail}`)
  const heldOut = input.spec.split === "held_out"
  return `## Spec
${input.spec.text}
${heldOut ? "\nThis is a held-out spec used for evaluation: fix it, but write no lessons (\"lessons\": [])." : ""}

## Attempt
${input.attempt} of ${input.repairBudget}

## Failures (from hidden checks)
${list(failures)}
DRC errors: ${input.result.drc_errors}

## Previous attempt's failures
${previous ? list(previous) : "(first attempt)"}

## Lessons in the coder's context
${input.lessons.length ? input.lessons.map((l) => `- [${l._id}] ${l.pattern}. Fix: ${l.fix}`).join("\n") : "(none)"}

## Harness rules
${list(input.rules)}

## Parts
${compactWhitelist()}

## Layout
${input.layout || "(the code did not render)"}

## Board code
\`\`\`tsx
${input.code}
\`\`\``
}
