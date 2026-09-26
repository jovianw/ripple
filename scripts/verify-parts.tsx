// Renders every part in parts/whitelist.json alone on a board and fails on any error. Also measures each part's
// courtyard and pad positions (the coder places parts from these) and fails if the stored ones are stale.
// Usage: npm run verify:parts            check
//        npm run verify:parts -- --write  store the measured footprints in parts/whitelist.json
import { readFileSync, writeFileSync } from "node:fs"
import { createElement } from "react"
import { RootCircuit } from "tscircuit"

type Footprint = { courtyard: [number, number]; pads: Record<string, [number, number]> }
type Part = { id: string; element: string; props: Record<string, unknown>; exampleProps?: Record<string, unknown>; footprint?: Footprint }
type El = { type: string; [k: string]: any }
const FILE = "parts/whitelist.json"
const whitelist = JSON.parse(readFileSync(FILE, "utf8")) as { parts: Part[] }
const write = process.argv.includes("--write")

const defaults: Record<string, Record<string, unknown>> = {
  resistor: { resistance: "1k" },
  capacitor: { capacitance: "100nF" },
  led: { color: "red" },
}

const r2 = (v: number) => Math.round(v * 100) / 100 + 0 // + 0 turns -0 into 0

/** Courtyard size (bounding box of courtyard rects/outlines, else the body) and pad centres by pin label, at rotation 0. */
function measure(json: El[], pinLabels: Record<string, string> = {}): Footprint {
  const xs: number[] = []
  const ys: number[] = []
  for (const e of json) {
    if (e.type === "pcb_courtyard_rect") { xs.push(e.center.x - e.width / 2, e.center.x + e.width / 2); ys.push(e.center.y - e.height / 2, e.center.y + e.height / 2) }
    if (e.type === "pcb_courtyard_outline") for (const p of e.outline) { xs.push(p.x); ys.push(p.y) }
  }
  if (!xs.length) {
    const c = json.find((e) => e.type === "pcb_component")!
    xs.push(c.center.x - c.width / 2, c.center.x + c.width / 2)
    ys.push(c.center.y - c.height / 2, c.center.y + c.height / 2)
  }
  const names = new Map(json.filter((e) => e.type === "source_port").map((e) => [e.source_port_id, e.name as string]))
  const pads: Record<string, [number, number]> = {}
  for (const p of json.filter((e) => e.type === "pcb_port")) {
    const pin = names.get(p.source_port_id)!
    pads[pinLabels[pin] ?? pin] = [r2(p.x), r2(p.y)]
  }
  return { courtyard: [r2(Math.max(...xs) - Math.min(...xs)), r2(Math.max(...ys) - Math.min(...ys))], pads }
}

let failed = 0
for (const part of whitelist.parts) {
  const circuit = new RootCircuit()
  circuit.add(
    <board width="30mm" height="30mm">
      {createElement(part.element, { name: "U1", pcbX: 0, pcbY: 0, ...defaults[part.element], ...part.exampleProps, ...part.props })}
    </board>,
  )
  await circuit.renderUntilSettled()
  const json = circuit.getCircuitJson() as El[]
  const errors = json.filter((e) => e.type.endsWith("_error")) as { message?: string }[]
  const ports = json.filter((e) => e.type === "source_port").length
  const measured = measure(json, part.props.pinLabels as Record<string, string> | undefined)
  const stale = JSON.stringify(part.footprint) !== JSON.stringify(measured)
  if (write) part.footprint = measured
  const ok = errors.length === 0 && ports > 0 && (write || !stale)
  if (!ok) failed++
  console.log(`${ok ? "ok  " : "FAIL"} ${part.id} (${ports} pins, ${measured.courtyard.join(" x ")}mm)${errors.map((e) => `\n     ${e.message}`).join("")}${
    !write && stale ? "\n     stored footprint is stale: run npm run verify:parts -- --write" : ""}`)
}
if (write) {
  // Keep [x, y] pairs on one line so the file stays readable.
  writeFileSync(FILE, JSON.stringify(whitelist, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, "[$1, $2]") + "\n")
  console.log(`wrote footprints to ${FILE}`)
}
console.log(`${whitelist.parts.length - failed}/${whitelist.parts.length} parts render`)
process.exit(failed ? 1 : 0)
