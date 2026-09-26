// Planner agent. Owner: Marcos.
// Turns a spec into work-queue items (one per subcircuit, plus an "assemble" step). It only returns items;
// enqueueing, running and cancelling them is the work queue's job (harness/queue.ts, Jovian).
// The model call is passed in as `complete` (Arjun's router).
import type { HarnessConfig } from "@ripple/types"
import { partsWhitelist } from "../../tools/parts-whitelist.js"
import {
  PLANNER_SCHEMA, PLANNER_SYSTEM, plannerUserPrompt, specHeaders,
  type HeaderReq, type PlannerInput, type PlannerOutput, type PlanSubcircuit, type PreviousPlan,
} from "./prompt.js"

export { PLANNER_SYSTEM, PLANNER_SCHEMA, plannerUserPrompt, specHeaders } from "./prompt.js"
export type { PlannerInput, PlannerOutput, PlanSubcircuit, PreviousPlan, HeaderReq } from "./prompt.js"
export { checkInterface } from "./interface.js"

/** Same shape as queue.ts NewItem. */
export interface WorkItemPlan {
  key: string
  title: string
  depends_on?: string[]
  payload?: Record<string, unknown>
}

/** What each subcircuit's work item carries for the coder. */
export interface SubcircuitPayload {
  kind: "subcircuit"
  purpose: string
  parts: PlanSubcircuit["parts"]
  nets: string[]
  headers: HeaderReq[]
  reuse_subcircuit_id: string
}

export interface Plan {
  summary: string
  nets: PlannerOutput["nets"]
  items: WorkItemPlan[]
  /** Unfinished items from a previous plan that this plan replaces (replans only). */
  cancel: string[]
  /** Validation errors the model never fixed; the plan fell back to a single item. */
  fallback_errors?: string[]
}

export interface PlannerDeps {
  complete(system: string, user: string, schema: typeof PLANNER_SCHEMA): Promise<unknown>
}

const KEY = /^[a-z][a-z0-9_]*$/
const NET = /^[A-Z][A-Z0-9_]*$/
const partIds = new Set(partsWhitelist.map((p) => p.id))

/** Every rule the plan must meet. Returns human-readable problems; empty means valid. */
export function validatePlan(out: PlannerOutput, headers: HeaderReq[], previous?: PreviousPlan): string[] {
  const errors: string[] = []
  const subs = out.subcircuits ?? []
  if (!subs.length) errors.push("plan has no subcircuits")
  const keys = new Set<string>()
  for (const s of subs) {
    if (!KEY.test(s.key)) errors.push(`key "${s.key}" must be snake_case`)
    if (keys.has(s.key)) errors.push(`duplicate key "${s.key}"`)
    keys.add(s.key)
    if (s.key.startsWith("assemble")) errors.push(`keys starting with "assemble" are reserved`)
    for (const p of s.parts) {
      if (!partIds.has(p.part)) errors.push(`${s.key}: part "${p.part}" is not on the whitelist`)
      if (!(p.qty >= 1)) errors.push(`${s.key}: part "${p.part}" needs qty >= 1`)
    }
    for (const n of s.nets) if (!NET.test(n)) errors.push(`${s.key}: net "${n}" must be an uppercase identifier starting with a letter`)
  }
  const done = new Set((previous?.items ?? []).filter((i) => i.status === "done").map((i) => i.key))
  for (const s of subs) {
    for (const d of s.depends_on) if (!keys.has(d) && !done.has(d)) errors.push(`${s.key} depends on unknown subcircuit "${d}"`)
  }
  // Cycles: repeatedly remove subcircuits whose dependencies are all resolved.
  const resolved = new Set(done)
  let left = subs.filter((s) => !done.has(s.key))
  for (let changed = true; changed && left.length; ) {
    const next = left.filter((s) => !s.depends_on.every((d) => resolved.has(d) || !keys.has(d)))
    changed = next.length < left.length
    for (const s of left) if (!next.includes(s)) resolved.add(s.key)
    left = next
  }
  if (left.length) errors.push(`dependency cycle among ${left.map((s) => s.key).join(", ")}`)
  // Headers: each spec header placed by exactly one subcircuit.
  headers.forEach((h, i) => {
    const owners = subs.filter((s) => s.headers.includes(i)).map((s) => s.key)
    if (owners.length !== 1) errors.push(`header ${i} (${h.labels.join(", ")}) must belong to exactly one subcircuit, has ${owners.length ? owners.join(", ") : "none"}`)
  })
  for (const s of subs) for (const i of s.headers) if (!headers[i]) errors.push(`${s.key}: header ${i} does not exist`)
  // Shared nets: declared, and used by at least two subcircuits when there is more than one.
  const declared = new Set((out.nets ?? []).map((n) => n.name))
  for (const s of subs) for (const n of s.nets) if (!declared.has(n)) errors.push(`${s.key}: net ${n} is not in the shared nets list`)
  if (subs.length > 1) {
    for (const n of declared) {
      const users = subs.filter((s) => s.nets.includes(n)).length
      if (users < 2) errors.push(`shared net ${n} is used by ${users} subcircuit(s); shared nets need at least two (or keep it internal)`)
    }
  }
  // Replans keep done items.
  for (const k of done) if (!keys.has(k)) errors.push(`done item "${k}" was dropped; keep done items`)
  return errors
}

const totalParts = (subs: PlanSubcircuit[]) => subs.reduce((n, s) => n + s.parts.reduce((m, p) => m + p.qty, 0), 0)

function payload(s: PlanSubcircuit, headers: HeaderReq[]): SubcircuitPayload {
  return {
    kind: "subcircuit", purpose: s.purpose, parts: s.parts, nets: s.nets,
    headers: s.headers.map((i) => headers[i]).filter(Boolean), reuse_subcircuit_id: s.reuse_subcircuit_id,
  }
}

/** One subcircuit covering the whole spec. */
function wholeBoard(specText: string, headers: HeaderReq[], subs: PlanSubcircuit[] = []): PlanSubcircuit {
  const byPart = new Map<string, { part: string; qty: number; for: string }>()
  for (const p of subs.flatMap((s) => s.parts)) {
    const e = byPart.get(p.part)
    byPart.set(p.part, e ? { ...e, qty: e.qty + p.qty, for: `${e.for}; ${p.for}` } : { ...p })
  }
  return {
    key: "board", title: "Whole board", purpose: specText, parts: [...byPart.values()], nets: [],
    headers: headers.map((_, i) => i), depends_on: [], reuse_subcircuit_id: "",
  }
}

/** "assemble" on the first plan; a fresh key on each replan, because enqueue ignores keys it already has. */
function assembleKey(previous?: PreviousPlan): string {
  const n = (previous?.items ?? []).filter((i) => i.key.startsWith("assemble")).length
  return n ? `assemble_r${n}` : "assemble"
}

function toItems(subs: PlanSubcircuit[], headers: HeaderReq[], doneKeys: Set<string>, assemble = "assemble"): WorkItemPlan[] {
  const items: WorkItemPlan[] = subs
    .filter((s) => !doneKeys.has(s.key))
    .map((s) => ({ key: s.key, title: s.title, depends_on: s.depends_on, payload: { ...payload(s, headers) } }))
  if (subs.length > 1) {
    items.push({ key: assemble, title: "Assemble subcircuits into one board", depends_on: subs.map((s) => s.key), payload: { kind: "assemble" } })
  }
  return items
}

/**
 * Plans a board. Honors the harness config: no model call unless workflow.plan_first, and plans with
 * at most workflow.split_over_parts parts collapse into one item. Invalid plans get one retry with the
 * errors, then fall back to a single item.
 */
export async function plan(
  input: Omit<PlannerInput, "headers" | "errors">,
  config: Pick<HarnessConfig, "workflow">,
  deps: PlannerDeps,
): Promise<Plan> {
  const headers = specHeaders(input.spec.text)
  const doneKeys = new Set((input.previous?.items ?? []).filter((i) => i.status === "done").map((i) => i.key))
  const unfinished = (input.previous?.items ?? []).filter((i) => i.status !== "done").map((i) => i.key)

  if (!config.workflow.plan_first && !input.previous) {
    return { summary: "plan_first is off: one item for the whole board", nets: [], items: toItems([wholeBoard(input.spec.text, headers)], headers, doneKeys), cancel: [] }
  }

  let errors: string[] = []
  let out: PlannerOutput | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    out = (await deps.complete(PLANNER_SYSTEM, plannerUserPrompt({ ...input, headers, errors }), PLANNER_SCHEMA)) as PlannerOutput
    errors = validatePlan(out, headers, input.previous)
    if (!errors.length) break
  }
  if (!out || errors.length) {
    return {
      summary: "planner output stayed invalid; falling back to one item for the whole board",
      nets: [], items: toItems([wholeBoard(input.spec.text, headers, out?.subcircuits)], headers, doneKeys, assembleKey(input.previous)),
      cancel: unfinished, fallback_errors: errors,
    }
  }

  let subs = out.subcircuits
  if (subs.length > 1 && totalParts(subs) <= config.workflow.split_over_parts && !doneKeys.size) {
    subs = [wholeBoard(input.spec.text, headers, subs)]
  }
  const keep = new Set(subs.map((s) => s.key))
  return {
    summary: out.summary,
    nets: subs.length > 1 ? out.nets : [],
    items: toItems(subs, headers, doneKeys, assembleKey(input.previous)),
    // Unfinished items the new plan dropped or replaced (changed items get new keys, and so does assemble).
    cancel: unfinished.filter((k) => !keep.has(k)),
  }
}
