// Renders a board through the tscircuit autorouter and DRC.
// Usage: npm run smoke [led|t03]. Default: led. Exits 1 on any error.
import { writeFileSync, mkdirSync } from "node:fs"
import { RootCircuit } from "tscircuit"
import { runAllChecks } from "@tscircuit/checks"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { LedBoard } from "../examples/led-board.tsx"
import { T03Reference } from "../checks/reference/t03_ldo_3v3.tsx"

const boards = { led: LedBoard, t03: T03Reference }
const name = (process.argv[2] ?? "led") as keyof typeof boards
const Board = boards[name]
if (!Board) throw new Error(`unknown board ${name}; use ${Object.keys(boards).join("|")}`)

const circuit = new RootCircuit()
circuit.add(<Board />)
await circuit.renderUntilSettled()
const json = circuit.getCircuitJson()

const count = (type: string) => json.filter((e) => e.type === type).length
const renderErrors = json.filter((e) => e.type.endsWith("_error"))
const drcErrors = await runAllChecks(json)

mkdirSync("out", { recursive: true })
writeFileSync(`out/${name}.circuit.json`, JSON.stringify(json, null, 2))
writeFileSync(`out/${name}.pcb.svg`, convertCircuitJsonToPcbSvg(json))

console.log(`components: ${count("pcb_component")}, traces: ${count("pcb_trace")}, vias: ${count("pcb_via")}`)
console.log(`render errors: ${renderErrors.length}, DRC errors: ${drcErrors.length}`)
for (const e of [...renderErrors, ...drcErrors]) console.log(" -", (e as { message?: string }).message ?? e.type)
console.log(`wrote out/${name}.circuit.json, out/${name}.pcb.svg`)
process.exit(renderErrors.length + drcErrors.length > 0 ? 1 : 0)
