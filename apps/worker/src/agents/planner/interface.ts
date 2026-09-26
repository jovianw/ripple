// Checks a finished subcircuit against its plan: the worker calls this after compile + route + DRC,
// before marking the step done. Pure function over Circuit JSON; no DB, no model.
import { partsWhitelist } from "../../tools/parts-whitelist.js"
import type { SubcircuitPayload } from "./index.js"

type El = { type: string; [k: string]: any }

/** Problems with the subcircuit's interface; empty means it matches the plan. */
export function checkInterface(plan: SubcircuitPayload, circuitJson: El[]): string[] {
  const problems: string[] = []
  const comps = circuitJson.filter((e) => e.type === "source_component")
  const netNames = new Set(circuitJson.filter((e) => e.type === "source_net").map((e) => String(e.name)))
  for (const n of plan.nets) if (!netNames.has(n)) problems.push(`planned shared net ${n} is missing (connect it with net.${n})`)

  // Chips must be planned (matched by manufacturer part number).
  const plannedChips = new Map<string, number>()
  for (const p of plan.parts) {
    const mpn = partsWhitelist.find((w) => w.id === p.part)?.props.manufacturerPartNumber as string | undefined
    if (mpn) plannedChips.set(mpn, (plannedChips.get(mpn) ?? 0) + p.qty)
  }
  const usedChips = new Map<string, number>()
  for (const c of comps) if (c.manufacturer_part_number) usedChips.set(c.manufacturer_part_number, (usedChips.get(c.manufacturer_part_number) ?? 0) + 1)
  // An empty parts list (whole-board fallback) means the plan didn't constrain parts.
  if (plan.parts.length) for (const [mpn, n] of usedChips) {
    if (!plannedChips.has(mpn)) problems.push(`${mpn} is not in this subcircuit's plan`)
    else if (n > plannedChips.get(mpn)!) problems.push(`${n}x ${mpn} used, plan has ${plannedChips.get(mpn)}`)
  }
  for (const [mpn] of plannedChips) if (!usedChips.has(mpn)) problems.push(`planned ${mpn} is missing`)

  // Headers carrying the planned labels. Order doesn't matter: the hidden checks find header pins by label.
  const headerPorts = (c: El) => circuitJson.filter((e) => e.type === "source_port" && e.source_component_id === c.source_component_id)
  const headerLabels = comps.filter((c) => c.ftype === "simple_pin_header").map((c) =>
    headerPorts(c).map((p) => String((p.port_hints ?? []).find((h: string) => !/^(pin)?\d+$/.test(h)) ?? p.name).toUpperCase()).sort().join(","))
  for (const h of plan.headers) {
    const want = h.labels.map((l) => l.toUpperCase()).sort().join(",")
    if (!headerLabels.includes(want)) {
      problems.push(`header (${h.labels.join(", ")}) is missing or its labels differ (headers found: ${headerLabels.length ? headerLabels.map((l) => `(${l})`).join(" ") : "none"})`)
    }
  }
  return problems
}
