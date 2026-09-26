// Renders a board through the tscircuit autorouter and DRC.
// Usage: npm run smoke [led|<spec id>|t03]. Default: led. Exits 1 on any error.
import { writeFileSync, mkdirSync } from "node:fs"
import { RootCircuit } from "tscircuit"
import { runAllChecks } from "@tscircuit/checks"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { LedBoard } from "../examples/led-board.tsx"
import { referenceBoards } from "../checks/reference/index.ts"

// Reference boards by full spec id or short prefix (t03, h01...).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boards: Record<string, () => any> = { led: LedBoard, ...referenceBoards }
for (const id of Object.keys(referenceBoards)) boards[id.split("_")[0]] = referenceBoards[id]
const name = process.argv[2] ?? "led"
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
