// Long-horizon board runner. Owner: Marcos.
// planner work items -> coder per subcircuit -> route + DRC + checkInterface -> assembler + hidden checks,
// driven by the durable queue (harness/queue.ts): kill the worker at any point, rerun, it resumes.
//
// Each subcircuit step stores its code as a `boards` document in the same transaction that marks the step done,
// so the assemble step (and a restarted worker) reads finished subcircuits back from Atlas, never from memory.
import type { HarnessConfig, Lesson, RunResult } from "@ripple/types"
import type { Document } from "mongodb"
import { col } from "../db.js"
import { enqueue, progress, runQueue, type Handler } from "../harness/queue.js"
import { plan, checkInterface, type PlannerDeps, type Plan, type SubcircuitPayload } from "../agents/planner/index.js"
import type { CoderInput } from "../agents/coder.js"
import { assemble } from "../assembler/assembler.js"
import { getPart, partExample } from "../tools/parts-whitelist.js"
import { evaluateCircuitSource } from "../tools/evaluate.js"

/**
 * Mechanical fixes to coder output that don't change the design:
 * - trace-length limits (maxLength, and decouplingFor/decouplingTo, which make tscircuit enforce a ~1mm decoupling
 *   trace) only ever block the autorouter; the hidden checks verify capacitor placement instead;
 * - ".R1.pin2" selectors -> ".R1 > .pin2".
 */
export function normalizeCoderSource(source: string): string {
  return source
    .replace(/\s+(?:maxLength|maxDecouplingTraceLength|decouplingFor|decouplingTo)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "")
    .replace(/\b(from|to)="\.([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)"/g, '$1=".$2 > .$3"')
}

type El = { type: string; [k: string]: unknown }

export interface CoderOutput {
  source: string
  circuitJson: El[]
  model?: { tier?: "cheap" | "strong"; totalTokens?: number; costUsd?: number }
}

export interface PlannedBoardDeps {
  /** Arjun's runCoder, or a stand-in for dry runs. */
  coder(input: CoderInput): Promise<CoderOutput>
  /** Model call for the planner (Arjun's `complete` adapter), or a stand-in. */
  planner: PlannerDeps
  /** Lessons relevant to one subcircuit (memory.retrieveLessons); omit for no memory. */
  lessons?(query: string): Promise<Lesson[]>
  log?: (msg: string) => void
}

export interface PlannedBoardSpec {
  _id: string
  text: string
}

const pascal = (key: string) => key.replace(/(^|_)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase())
const prefix = (key: string) => key.replace(/[^a-z0-9]/g, "").slice(0, 4).toUpperCase()

/** What the coder is asked to build for one subcircuit. The coder writes a standalone board; we make it a group. */
export function subcircuitSpec(spec: PlannedBoardSpec, key: string, p: SubcircuitPayload): string {
  // Show the exact JSX for each part: ids like temp_sensor_lm75 are whitelist names, not tscircuit elements.
  const parts = p.parts.map((x) => {
    const w = getPart(x.part)
    const letter = ({ resistor: "R", capacitor: "C", led: "D", pinheader: "J", pushbutton: "SW", crystal: "Y", diode: "D" } as Record<string, string>)[w?.element ?? ""] ?? "U"
    return `- ${x.qty}x ${x.for}: ${w ? partExample(w, `${prefix(key)}_${letter}1`) : x.part}`
  }).join("\n")
  const headers = p.headers.map((h) => `- a ${h.labels.length}-pin header with pin labels (${h.labels.join(", ")}), exactly as written`).join("\n")
  return `You are building ONE subcircuit of a larger board, not the whole board.

Whole board (for context only): ${spec.text}

This subcircuit: ${p.purpose}

Parts to use, written exactly like this (change only name and values; ids such as temp_sensor_lm75 are
whitelist names, never JSX elements):
${parts || "- (choose from the whitelist)"}
${headers ? `\nHeaders this subcircuit places:\n${headers}\n` : ""}
Shared nets: connect to the rest of the board ONLY through these named nets, with trace to="net.NAME":
${p.nets.length ? p.nets.map((n) => `- net.${n}`).join("\n") : "- (none: this subcircuit is the whole board)"}
Do not add parts that belong to other subcircuits.
Give every part an explicit pcbX/pcbY, at least 2mm apart. Do not set maxLength or any other trace constraint:
place the parts, the autorouter routes. Do not use decouplingFor or decouplingTo on capacitors.
Reference pins in traces as ".NAME > .PIN" (e.g. ".I2CS_R1 > .pin2"), never ".NAME.PIN".
Name every component with the prefix ${prefix(key)}_ (e.g. ${prefix(key)}_R1, ${prefix(key)}_U1) so names stay unique on the assembled board.`
}

/** Coder output (`export default () => (<board ...>...</board>)`) -> assembler subcircuit (`export const X = () => (<group name=...>)`). */
export function boardModuleToGroup(source: string, key: string): string {
  const open = /<board\b[^>]*>/
  const close = /<\/board>(?![\s\S]*<\/board>)/
  if (!open.test(source) || !close.test(source)) throw new Error(`subcircuit ${key}: coder output has no <board> element`)
  return source
    .replace(open, `<group name="${key}">`)
    .replace(close, "</group>")
    .replace(/export\s+default\s+(function\s*\w*\s*)?/, (_m, fn) => (fn ? `export function ${pascal(key)}` : `export const ${pascal(key)} = `))
}

const now = () => new Date().toISOString()

/** Plans and enqueues the board unless it's already queued (a rerun resumes instead of replanning). */
export async function startPlannedBoard(boardId: string, spec: PlannedBoardSpec, config: HarnessConfig, deps: PlannedBoardDeps): Promise<Plan | null> {
  if (await col.queue.countDocuments({ board_id: boardId })) return null
  // This is the planned (long-horizon) path, so it always plans; workflow.plan_first governs the single-board loop.
  // split_over_parts still applies: a small plan collapses back to one item.
  const p = await plan({ spec, rules: config.rules, library: [] }, { workflow: { ...config.workflow, plan_first: true } }, deps.planner)
  await enqueue(boardId, p.items)
  deps.log?.(`planned ${p.items.length} item(s): ${p.items.map((i) => i.key).join(", ")}${p.fallback_errors ? ` (fallback: ${p.fallback_errors.join("; ")})` : ""}`)
  return p
}

/** The queue handler: one subcircuit or the final assembly per call. Throwing fails the attempt; the queue retries. */
export function plannedBoardHandler(spec: PlannedBoardSpec, config: HarnessConfig, deps: PlannedBoardDeps): Handler {
  const base = (boardId: string) => ({ board_id: boardId, harness_version: config.version, ts: now() })

  return async (item) => {
    const payload = item.payload as (SubcircuitPayload | { kind: "assemble" }) | undefined
    if (payload?.kind === "assemble") {
      const keys = (item.depends_on ?? []).map((id) => id.slice(item.board_id.length + 1))
      const docs = await col.boards
        .find({ board_id: item.board_id, kind: "subcircuit", key: { $in: keys } }, { sort: { created_at: -1 } })
        .toArray()
      const latest = new Map<string, Document>()
      for (const d of docs) if (!latest.has(d.key)) latest.set(d.key, d)
      const missing = keys.filter((k) => !latest.has(k))
      if (missing.length) throw new Error(`assemble: no finished subcircuit for ${missing.join(", ")}`)
      const r = await assemble(keys.map((k) => ({ name: k, code: latest.get(k)!.group_code as string })), { specId: spec._id })
      const result = r.result!
      const run: RunResult = { ...result, ...base(item.board_id), stage: "final" }
      deps.log?.(`assembled ${keys.length} subcircuits: ${result.passed ? "passed" : `failed ${result.failures.length} hidden check(s)`}`)
      // Assembly is deterministic, so a hidden-check failure is recorded, not retried; the critic/replan acts on it.
      return {
        run,
        board: {
          board_id: item.board_id, kind: "final", spec_id: spec._id, harness_version: config.version,
          code: r.code, circuit_json: r.circuitJson, passed: result.passed, failures: result.failures,
          subcircuits_used: keys, created_at: new Date(),
        },
      }
    }

    // A subcircuit (or the whole board when the plan didn't split).
    const p = payload as SubcircuitPayload
    const lessons = deps.lessons ? await deps.lessons(`${p.purpose}. ${p.parts.map((x) => x.part).join(", ")}`) : undefined
    let out = await deps.coder({
      specText: p.nets.length ? subcircuitSpec(spec, item.key, p) : spec.text,
      config,
      lessons,
      previousFailure: item.attempts > 1 ? (item as { error?: string }).error : undefined,
    })
    const normalized = normalizeCoderSource(out.source)
    if (normalized !== out.source) {
      out = { ...out, source: normalized, circuitJson: (await evaluateCircuitSource(normalized)).circuitJson as unknown as El[] }
      deps.log?.(`${item.key}: normalized coder output (trace-length limits, selector syntax)`)
    }
    // Shared nets (V3V3, SDA...) only get their other ends at assembly, so a subcircuit routed on its own can't
    // finish them. Defer "not connected" errors on planned shared nets to the assembled board, which gets full
    // DRC and the hidden checks; every other render, placement or routing error still fails the step.
    const shared = new Set(p.nets)
    const deferred = (e: El) =>
      e.type === "pcb_port_not_connected_error" &&
      [...String(e.message ?? "").matchAll(/net \[([^\]]+)\]/g)].some((m) => shared.has(m[1]))
    const errors = out.circuitJson
      .filter((e) => e.type.endsWith("_error") && !deferred(e))
      .map((e) => `${e.type}: ${(e.message as string) ?? ""}`)
    const problems = [...errors, ...checkInterface(p, out.circuitJson as never)]
    if (problems.length) throw new Error(`${item.key}: ${problems.slice(0, 8).join("; ")}`)
    const group_code = boardModuleToGroup(out.source, item.key)
    const run: RunResult = {
      ...base(item.board_id), stage: "subcircuit", passed: true, failures: [], drc_errors: 0,
      model: out.model?.tier, tokens: out.model?.totalTokens, cost_usd: out.model?.costUsd,
    }
    return {
      run,
      board: { board_id: item.board_id, kind: "subcircuit", key: item.key, spec_id: spec._id, source: out.source, group_code, created_at: new Date() },
    }
  }
}

/** Plans (first run only) and runs the board's queue to the end. Safe to call again after a crash. */
export async function runPlannedBoard(boardId: string, spec: PlannedBoardSpec, config: HarnessConfig, deps: PlannedBoardDeps) {
  await startPlannedBoard(boardId, spec, config, deps)
  await runQueue(boardId, plannedBoardHandler(spec, config, deps), { log: deps.log })
  const final = await col.boards.findOne({ board_id: boardId, kind: "final" }, { sort: { created_at: -1 } })
  return { progress: await progress(boardId), final }
}
