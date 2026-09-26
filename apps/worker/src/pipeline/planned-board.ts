// Long-horizon board runner. Owner: Marcos.
// planner work items -> coder per subcircuit -> route + DRC + checkInterface -> assembler + hidden checks,
// driven by the durable queue (harness/queue.ts): kill the worker at any point, rerun, it resumes.
//
// Each subcircuit step stores its code as a `boards` document in the same transaction that marks the step done,
// so the assemble step (and a restarted worker) reads finished subcircuits back from Atlas, never from memory.
import type { CheckFailure, HarnessConfig, Lesson, RunResult } from "@ripple/types"
import type { Document } from "mongodb"
import { col } from "../db.js"
import { enqueue, progress, runQueue, type Handler } from "../harness/queue.js"
import { plan, checkInterface, type PlannerDeps, type Plan, type SubcircuitPayload } from "../agents/planner/index.js"
import type { CoderInput } from "../agents/coder.js"
import { assemble } from "../assembler/assembler.js"
import { getPart, partExample } from "../tools/parts-whitelist.js"
import { evaluateCircuitSource } from "../tools/evaluate.js"
import { bakePlacement, normalizeCoderSource, withoutPlacement } from "../tools/normalize.js"
import { attributeFailures } from "./attribute.js"

const OVERLAP = /overlap|placement_error|outside_board/

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
  /** Critic diagnosis for a subcircuit the assembled board blamed; omit to pass the raw failures only. */
  critic?(ctx: { subKey: string; code: string; failures: CheckFailure[]; round: number; maxRounds: number }): Promise<string | undefined>
  /** Repair rounds after a failed assembly (default 2). 0 records the failure without repairing. */
  maxRepairRounds?: number
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
  // Exact header JSX with the spec's labels: without pinLabels the header's pins are just pin1..pinN.
  const headers = p.headers.map((h, i) =>
    `- <pinheader name="${prefix(key)}_J${i + 1}" pinCount={${h.labels.length}} footprint="pinrow${h.labels.length}" pinLabels={${JSON.stringify(h.labels)}} />`).join("\n")
  return `You are building ONE subcircuit of a larger board, not the whole board.

Whole board (for context only): ${spec.text}

This subcircuit: ${p.purpose}

Parts to use, written exactly like this (change only name and values; ids such as temp_sensor_lm75 are
whitelist names, never JSX elements):
${parts || "- (choose from the whitelist)"}
${headers ? `\nHeaders this subcircuit places, written exactly like this (keep pinLabels):\n${headers}\n` : ""}
Shared nets: connect to the rest of the board ONLY through these named nets, with trace to="net.NAME":
${p.nets.length ? p.nets.map((n) => `- net.${n}`).join("\n") : "- (none: this subcircuit is the whole board)"}
Do not add parts that belong to other subcircuits.
Leave out pcbX/pcbY: parts are placed after you write the code, each cap, resistor and LED beside the pin it is
wired to, so wire each one to the pin it serves (a decoupling cap to that chip's supply pin). Do not set maxLength
or any other trace constraint: the autorouter routes. Do not use decouplingFor or decouplingTo on capacitors.
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

/**
 * Caps, resistors, LEDs and diodes with no trace on any pin. tscircuit renders them without an error, and the gap
 * only showed after assembly (the sensors' decoupling caps sat alone, so the chips had no cap near VCC); repair
 * rounds didn't find it. Failing the step names the part, so the queue's retry tells the coder what to wire.
 */
export function unwiredParts(circuitJson: El[]): string[] {
  const wired = new Set(circuitJson.filter((e) => e.type === "source_trace").flatMap((t) => (t.connected_source_port_ids as string[] | undefined) ?? []))
  const portsOf = new Map<string, string[]>()
  for (const sp of circuitJson.filter((e) => e.type === "source_port"))
    portsOf.set(sp.source_component_id as string, [...(portsOf.get(sp.source_component_id as string) ?? []), sp.source_port_id as string])
  return circuitJson
    .filter((c) => c.type === "source_component" && ["simple_capacitor", "simple_resistor", "simple_led", "simple_diode"].includes(c.ftype as string))
    .filter((c) => !(portsOf.get(c.source_component_id as string) ?? []).some((id) => wired.has(id)))
    .map((c) => `${c.name} is not wired to anything: add a trace from each of its pins to the pin or net it serves`)
}

const now = () => new Date().toISOString()

/** A subcircuit rebuilt because the assembled board failed hidden checks it caused. */
export interface RepairInfo {
  /** The subcircuit being repaired (its group name, part prefix and board doc key stay the same). */
  of: string
  round: number
  failures: CheckFailure[]
  previous_source: string
  diagnosis?: string
}
type StepPayload = SubcircuitPayload & { repair?: RepairInfo }
type AssemblePayload = { kind: "assemble"; keys?: string[]; round?: number }

function repairSection(r: RepairInfo): string {
  return `

## The assembled board failed these checks, caused by this subcircuit (repair round ${r.round})
${r.failures.map((f) => `- ${f.check}: ${f.detail}`).join("\n")}
${r.diagnosis ? `\n## Diagnosis and fix\n${r.diagnosis}\n` : ""}
Fix only the parts in THIS subcircuit. Some failures involve parts in other subcircuits (e.g. the USB connector,
the MCU): never add those parts here; just make sure your side of the shared nets (net.NAME) is connected.

## Your previous version: edit it, keep everything that already works
\`\`\`tsx
${r.previous_source}
\`\`\``
}

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
    const payload = item.payload as (StepPayload | AssemblePayload) | undefined
    if (payload?.kind === "assemble") {
      const round = payload.round ?? 0
      const keys = payload.keys ?? (item.depends_on ?? []).map((id) => id.slice(item.board_id.length + 1))
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
      deps.log?.(`assembled ${keys.length} subcircuits${round ? ` (repair round ${round})` : ""}: ${result.passed ? "passed" : `failed ${result.failures.length} hidden check(s)`}`)

      // Repair loop: blame each failure on the subcircuit that caused it, rebuild just those, reassemble.
      // Enqueued before this step commits; keys are deterministic, so a crash and rerun enqueues nothing twice.
      const maxRounds = deps.maxRepairRounds ?? 2
      // Stop when a repair round didn't reduce the failures: more rounds rarely recover, and the best board is kept.
      let improving = true
      if (round > 0) {
        const prev = await col.boards.findOne({ board_id: item.board_id, kind: "final", round: round - 1 }, { sort: { created_at: -1 } })
        const before = (prev?.failures as unknown[] | undefined)?.length ?? Infinity
        improving = result.failures.length < before
        if (!improving) deps.log?.(`repair round ${round} didn't improve (${before} -> ${result.failures.length} failures); stopping, best round kept`)
      }
      if (!result.passed && round < maxRounds && improving) {
        const blame = attributeFailures(result.failures, r.circuitJson as never, keys)
        if (blame.bySubcircuit.size) {
          const next = round + 1
          const repairs = []
          for (const [subKey, failures] of blame.bySubcircuit) {
            const doc = latest.get(subKey)!
            const original = (doc.payload ?? (await col.queue.findOne({ board_id: item.board_id, key: subKey }))?.payload) as StepPayload
            const code = doc.source as string
            const diagnosis = deps.critic ? await deps.critic({ subKey, code, failures, round: next, maxRounds }) : undefined
            repairs.push({
              key: `${subKey}_r${next}`,
              title: `Repair ${subKey} (round ${next}): ${failures.length} failure(s)`,
              payload: { ...original, repair: { of: subKey, round: next, failures, previous_source: code, diagnosis } } as unknown as Record<string, unknown>,
            })
          }
          await enqueue(item.board_id, [
            ...repairs,
            { key: `assemble_r${next}`, title: `Reassemble (repair round ${next})`, depends_on: repairs.map((x) => x.key), payload: { kind: "assemble", keys, round: next } },
          ])
          deps.log?.(`repair round ${next}: ${[...blame.bySubcircuit].map(([k, f]) => `${k} (${f.length})`).join(", ")}${blame.unattributed.length ? `; ${blame.unattributed.length} failure(s) not tied to a block` : ""}`)
        } else {
          deps.log?.(`no failure could be tied to a subcircuit; not repairing`)
        }
      }
      return {
        run,
        board: {
          board_id: item.board_id, kind: "final", spec_id: spec._id, harness_version: config.version,
          code: r.code, circuit_json: r.circuitJson, passed: result.passed, failures: result.failures,
          subcircuits_used: keys, round, created_at: new Date(),
        },
      }
    }

    // A subcircuit (or the whole board when the plan didn't split), or a repair of one.
    const p = payload as StepPayload
    const subKey = p.repair?.of ?? item.key
    const lessons = deps.lessons ? await deps.lessons(`${p.purpose}. ${p.parts.map((x) => x.part).join(", ")}`) : undefined
    const lastRepairAttempt = !!p.repair && item.attempts >= ((item as { max_attempts?: number }).max_attempts ?? 3)
    const keepPrevious = (why: string) => {
      deps.log?.(`${item.key}: repair failed ${item.attempts}x; keeping ${subKey}'s previous version`)
      return { run: { ...base(item.board_id), stage: "repair", passed: false, failures: [{ check: "repair", detail: why.slice(0, 500) }], drc_errors: 0 } as RunResult }
    }
    let out: CoderOutput
    try {
      out = await deps.coder({
      specText: (p.nets.length ? subcircuitSpec(spec, subKey, p) : spec.text) + (p.repair ? repairSection(p.repair) : ""),
      config,
      lessons,
      previousFailure: item.attempts > 1 ? (item as { error?: string }).error : undefined,
      })
    } catch (err) {
      if (lastRepairAttempt) return keepPrevious(err instanceof Error ? err.message : String(err))
      throw err
    }
    const render = async (source: string) => (await evaluateCircuitSource(source)).circuitJson as unknown as El[]
    const normalized = normalizeCoderSource(out.source)
    if (normalized !== out.source) out = { ...out, source: normalized, circuitJson: await render(normalized) }
    // Parts on top of each other: let tscircuit place them instead, if that renders with fewer errors.
    const errorCount = (json: El[]) => json.filter((e) => e.type.endsWith("_error")).length
    if (out.circuitJson.some((e) => e.type.endsWith("_error") && OVERLAP.test(`${e.type} ${e.message ?? ""}`))) {
      const auto = withoutPlacement(out.source)
      const json = await render(auto)
      if (errorCount(json) < errorCount(out.circuitJson)) {
        // Lock tscircuit's positions into the code so the block assembles exactly as it measured.
        const baked = bakePlacement(auto, json)
        const bakedJson = await render(baked)
        out = errorCount(bakedJson) <= errorCount(json) ? { ...out, source: baked, circuitJson: bakedJson } : { ...out, source: auto, circuitJson: json }
        deps.log?.(`${item.key}: coder's parts overlapped; using tscircuit's placement instead${out.source === baked ? " (positions locked)" : ""}`)
      }
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
    // A repair may swap a part the plan chose (e.g. the wrong MCU for the header), so it isn't held to the plan's chips.
    const problems = [...errors, ...unwiredParts(out.circuitJson), ...checkInterface(p.repair ? { ...p, parts: [] } : p, out.circuitJson as never)]
    // A repair that used its last attempt keeps the block's previous version instead of blocking reassembly.
    // Show the coder its own header line when the header is wrong, so the retry can see what to change.
    if (problems.some((x) => x.startsWith("header ("))) {
      const written = out.source.match(/<pinheader\b[^>]*>/g)
      problems.push(`your header code: ${written ? written.join(" ") : "(no <pinheader> in the code)"}`)
    }
    if (problems.length && lastRepairAttempt) return keepPrevious(problems.slice(0, 4).join("; "))
    if (problems.length) throw new Error(`${item.key}: ${problems.slice(0, 8).join("; ")}`)
    const group_code = boardModuleToGroup(out.source, subKey)
    const run: RunResult = {
      ...base(item.board_id), stage: "subcircuit", passed: true, failures: [], drc_errors: 0,
      model: out.model?.tier, tokens: out.model?.totalTokens, cost_usd: out.model?.costUsd,
    }
    return {
      run,
      board: {
        board_id: item.board_id, kind: "subcircuit", key: subKey, item_key: item.key, round: p.repair?.round ?? 0,
        spec_id: spec._id, source: out.source, group_code, payload: { ...p, repair: undefined }, created_at: new Date(),
      },
    }
  }
}

/** The best assembled board so far: passed first, then fewest hidden-check failures, then the latest. */
export async function bestFinal(boardId: string) {
  const finals = await col.boards.find({ board_id: boardId, kind: "final" }).toArray()
  const score = (d: Document) => (d.passed ? -1 : ((d.failures as unknown[] | undefined)?.length ?? Infinity))
  return finals.sort((a, b) => score(a) - score(b) || +new Date(b.created_at) - +new Date(a.created_at))[0] ?? null
}

/** Plans (first run only) and runs the board's queue to the end. Safe to call again after a crash. */
export async function runPlannedBoard(boardId: string, spec: PlannedBoardSpec, config: HarnessConfig, deps: PlannedBoardDeps) {
  await startPlannedBoard(boardId, spec, config, deps)
  await runQueue(boardId, plannedBoardHandler(spec, config, deps), { log: deps.log })
  return { progress: await progress(boardId), final: await bestFinal(boardId) }
}
