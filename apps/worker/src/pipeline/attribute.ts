// Blames each hidden-check failure on the assembled board to the subcircuit(s) that caused it, so the repair loop
// can rebuild just those blocks. Owner: Marcos. Pure function over Circuit JSON; no DB, no model.
//
// Every part sits in its subcircuit's <group name=key> on the assembled board, so part -> subcircuit is exact.
// Failure details name parts directly ("MICR_U1 VCC is not connected") or through the checker's selectors
// ("role:mcu.VCC", "part:usb_c_receptacle.CC1", "header:SDA"), which resolve to parts via the whitelist.
import type { CheckFailure } from "@ripple/types"
import { partsWhitelist } from "../tools/parts-whitelist.js"

type El = { type: string; [k: string]: any }

export interface Attribution {
  /** subcircuit key -> failures it caused */
  bySubcircuit: Map<string, CheckFailure[]>
  /** failures that name no part (e.g. a missing named net); nothing to repair automatically */
  unattributed: CheckFailure[]
}

/** Component name -> the subcircuit key whose group contains it. */
export function componentSubcircuits(circuitJson: El[], subKeys: string[]): Map<string, string> {
  const keys = new Set(subKeys)
  const groups = new Map(circuitJson.filter((e) => e.type === "source_group").map((g) => [g.source_group_id, g]))
  const owner = (groupId: string | undefined): string | undefined => {
    for (let g = groupId ? groups.get(groupId) : undefined; g; g = g.parent_source_group_id ? groups.get(g.parent_source_group_id) : undefined) {
      if (keys.has(g.name)) return g.name
    }
    return undefined
  }
  const out = new Map<string, string>()
  for (const c of circuitJson.filter((e) => e.type === "source_component")) {
    const k = owner(c.source_group_id)
    if (k) out.set(c.name, k)
  }
  return out
}

/** Component names a checker selector refers to: part:<whitelist id>, role:<role>, header:<label>. */
function selectorComponents(selector: string, circuitJson: El[]): string[] {
  const comps = circuitJson.filter((e) => e.type === "source_component")
  const [kind, rest] = selector.split(":")
  const target = rest.split(".")[0]
  if (kind === "part" || kind === "role") {
    const mpns = new Set(partsWhitelist
      .filter((p) => (kind === "part" ? p.id === target : p.roles?.includes(target)))
      .map((p) => p.props.manufacturerPartNumber as string | undefined)
      .filter(Boolean))
    return comps.filter((c) => mpns.has(c.manufacturer_part_number)).map((c) => c.name)
  }
  if (kind === "header") {
    const label = target.toLowerCase()
    const headerIds = new Set(circuitJson
      .filter((e) => e.type === "source_port" && [e.name, ...(e.port_hints ?? [])].some((h: string) => String(h).toLowerCase() === label))
      .map((p) => p.source_component_id))
    return comps.filter((c) => c.ftype === "simple_pin_header" && headerIds.has(c.source_component_id)).map((c) => c.name)
  }
  return []
}

export function attributeFailures(failures: CheckFailure[], circuitJson: El[], subKeys: string[]): Attribution {
  const owners = componentSubcircuits(circuitJson, subKeys)
  const names = [...owners.keys()].sort((a, b) => b.length - a.length) // longest first: MICR_U10 before MICR_U1
  const bySubcircuit = new Map<string, CheckFailure[]>()
  const unattributed: CheckFailure[] = []
  for (const f of failures) {
    const blamed = new Set<string>()
    // Parenthesised text is a hint ("(nearest USBA_C2 at 14mm)", "(pins: ...)"), not the part at fault.
    const subject = f.detail.replace(/\([^)]*\)/g, "")
    for (const n of names) if (new RegExp(`(^|[^A-Za-z0-9_])${n}([^A-Za-z0-9_]|$)`).test(subject)) blamed.add(owners.get(n)!)
    // Selectors only when the detail names no part directly (a named part is the more precise blame).
    if (!blamed.size) {
      for (const m of subject.matchAll(/\b(part|role|header):[A-Za-z0-9_]+/g)) {
        for (const n of selectorComponents(m[0], circuitJson)) { const k = owners.get(n); if (k) blamed.add(k) }
      }
    }
    if (!blamed.size) { unattributed.push(f); continue }
    for (const k of blamed) bySubcircuit.set(k, [...(bySubcircuit.get(k) ?? []), f])
  }
  return { bySubcircuit, unattributed }
}
