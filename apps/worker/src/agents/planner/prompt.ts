// Planner prompt. Owner: Marcos.
// Splits a spec into subcircuits that connect only through shared named nets, one work-queue item each.
import type { Spec } from "@ripple/types"
import { compactWhitelist } from "../critic/prompt.js"

export const PLANNER_SYSTEM = `You are the planner in Ripple, a harness that designs printed circuit boards in tscircuit.
Split a board spec into subcircuits. Each subcircuit is built and routed on its own as a tscircuit <group>,
then the groups are assembled into one board. Groups connect only through shared named nets.

## How to split
- One subcircuit per functional block: power input and regulation; microcontroller with its programming header;
  each sensor or peripheral; analog front ends. An LED goes with the block that drives it.
- A chip's decoupling capacitors, pull-ups, pull-downs and address straps belong in the same subcircuit as the chip.
  An I2C bus gets exactly one set of pull-ups, in one subcircuit.
- Aim for 3 to 10 parts per subcircuit. A small board is one subcircuit.
- Order by dependency: power first, then the blocks that use it. "depends_on" lists subcircuits that must be built first.

## Shared nets
- Only rails and buses are shared: e.g. VBUS, V3V3, GND, SDA, SCL. Everything else stays inside its subcircuit.
- Net names are uppercase identifiers that start with a letter (V3V3, not 3V3).
- Every shared net must be used by at least two subcircuits.

## Headers
- The spec names each header and its pin labels. Assign every header to exactly one subcircuit, with the labels exactly as written.

## Parts
- Use only whitelisted parts, by id, with a quantity. Count every part, including passives and headers.
- If a library subcircuit already does a block's job, set "reuse_subcircuit_id" to its id; otherwise "".

## Replanning
If a previous plan is given, some of its items are done. Keep done items exactly as they are (same key).
Change or replace only unfinished items, and give any changed item a new key. Explain the change in "summary".

Reply with JSON only, matching the schema.`

export interface HeaderReq {
  pins: number
  labels: string[]
}

export interface PlanPart {
  part: string
  qty: number
  for: string
}

export interface PlanSubcircuit {
  key: string
  title: string
  purpose: string
  parts: PlanPart[]
  nets: string[]
  /** Indexes into the spec's header list that this subcircuit places. */
  headers: number[]
  depends_on: string[]
  reuse_subcircuit_id: string
}

export interface PlannerOutput {
  summary: string
  nets: { name: string; kind: "power" | "ground" | "bus"; description: string }[]
  subcircuits: PlanSubcircuit[]
}

export interface PreviousPlan {
  items: { key: string; title: string; status: "pending" | "running" | "done" | "failed"; payload?: unknown }[]
  escalation: { key: string; reason: string }
}

export interface PlannerInput {
  spec: Pick<Spec, "_id" | "text">
  headers: HeaderReq[]
  rules: string[]
  library: { _id: string; name: string; description?: string }[]
  previous?: PreviousPlan
  /** Validation errors from the last attempt, for the one retry. */
  errors?: string[]
}

/** Headers named in spec text, e.g. "a 4-pin header (3V3, GND, SDA, SCL)". */
export function specHeaders(text: string): HeaderReq[] {
  return [...text.matchAll(/(\d+)-pin[^()]*?header\s*\(([^)]+)\)/g)].map((m) => ({
    pins: Number(m[1]),
    labels: m[2].split(",").map((s) => s.trim()),
  }))
}

export const PLANNER_SCHEMA = {
  name: "planner",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "nets", "subcircuits"],
    properties: {
      summary: { type: "string" },
      nets: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["name", "kind", "description"],
          properties: { name: { type: "string" }, kind: { type: "string", enum: ["power", "ground", "bus"] }, description: { type: "string" } },
        },
      },
      subcircuits: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["key", "title", "purpose", "parts", "nets", "headers", "depends_on", "reuse_subcircuit_id"],
          properties: {
            key: { type: "string", description: "snake_case, unique" },
            title: { type: "string" },
            purpose: { type: "string" },
            parts: {
              type: "array",
              items: {
                type: "object", additionalProperties: false, required: ["part", "qty", "for"],
                properties: { part: { type: "string" }, qty: { type: "integer" }, for: { type: "string" } },
              },
            },
            nets: { type: "array", items: { type: "string" } },
            headers: { type: "array", items: { type: "integer" } },
            depends_on: { type: "array", items: { type: "string" } },
            reuse_subcircuit_id: { type: "string" },
          },
        },
      },
    },
  },
} as const

const list = (items: string[]) => (items.length ? items.map((s) => `- ${s}`).join("\n") : "(none)")

export function plannerUserPrompt(input: PlannerInput): string {
  const headers = input.headers.map((h, i) => `${i}: ${h.pins}-pin header (${h.labels.join(", ")})`)
  const library = input.library.map((s) => `- [${s._id}] ${s.name}${s.description ? `: ${s.description}` : ""}`)
  const previous = input.previous
    ? `## Previous plan
${input.previous.items.map((i) => `- ${i.key} [${i.status}] ${i.title}${i.payload ? `\n  ${JSON.stringify(i.payload)}` : ""}`).join("\n")}

Escalated from ${input.previous.escalation.key}: ${input.previous.escalation.reason}
`
    : ""
  const errors = input.errors?.length ? `## Fix these problems in your last plan\n${list(input.errors)}\n` : ""
  return `## Spec
${input.spec.text}

## Headers (assign each index to exactly one subcircuit)
${list(headers)}

## Harness rules
${list(input.rules)}

## Library subcircuits
${library.length ? library.join("\n") : "(none)"}

## Parts
${compactWhitelist()}

${previous}${errors}`
}
