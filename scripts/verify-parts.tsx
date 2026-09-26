// Renders every part in parts/whitelist.json alone on a board and fails on any error.
// Usage: npm run verify:parts
import { readFileSync } from "node:fs"
import { createElement } from "react"
import { RootCircuit } from "tscircuit"

type Part = { id: string; element: string; props: Record<string, unknown> }
const { parts } = JSON.parse(readFileSync("parts/whitelist.json", "utf8")) as { parts: Part[] }

const defaults: Record<string, Record<string, unknown>> = {
  resistor: { resistance: "1k" },
  capacitor: { capacitance: "100nF" },
  led: { color: "red" },
}

let failed = 0
for (const part of parts) {
  const circuit = new RootCircuit()
  circuit.add(
    <board width="30mm" height="30mm">
      {createElement(part.element, { name: "U1", ...defaults[part.element], ...part.props })}
    </board>,
  )
  await circuit.renderUntilSettled()
  const json = circuit.getCircuitJson()
  const errors = json.filter((e) => e.type.endsWith("_error")) as { message?: string }[]
  const ports = json.filter((e) => e.type === "source_port").length
  const ok = errors.length === 0 && ports > 0
  if (!ok) failed++
  console.log(`${ok ? "ok  " : "FAIL"} ${part.id} (${ports} pins)${errors.map((e) => `\n     ${e.message}`).join("")}`)
}
console.log(`${parts.length - failed}/${parts.length} parts render`)
process.exit(failed ? 1 : 0)
