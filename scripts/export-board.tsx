// Exports every deliverable for a board: fabrication (Gerbers + drill), assembly (BOM, pick-and-place),
// KiCad project, 3D model, images, netlist, SPICE, design report and manifest.
// Usage: npm run export [led|<spec id>|t03|finale]     renders and grades a reference board, then exports it
//        npm run export -- --json path/to/board.circuit.json [name]   exports an existing Circuit JSON
// Writes out/<name>/ (unzipped), out/<name>-deliverables.zip, and out/<name>-gerbers.zip (for the board house).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { basename, dirname } from "node:path"
import { RootCircuit } from "tscircuit"
import type { AnyCircuitElement } from "circuit-json"
import specs from "../specs/specs.json" with { type: "json" }
import finale from "../specs/finale.json" with { type: "json" }
import { LedBoard } from "../examples/led-board.tsx"
import { referenceBoards } from "../checks/reference/index.ts"
import { runChecks, loadExpected } from "../checks/index.ts"
import { buildDeliverables, zipDeliverables, zipFabrication } from "../apps/worker/src/export/deliverables.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boards: Record<string, () => any> = { led: LedBoard, ...referenceBoards }
const fullId: Record<string, string> = {}
for (const id of Object.keys(referenceBoards)) { boards[id.split("_")[0]] = referenceBoards[id]; fullId[id.split("_")[0]] = id; fullId[id] = id }

let circuitJson: AnyCircuitElement[]
let name: string
if (process.argv[2] === "--json") {
  const path = process.argv[3]
  if (!path) throw new Error("usage: npm run export -- --json <file> [name]")
  circuitJson = JSON.parse(readFileSync(path, "utf8"))
  name = process.argv[4] ?? basename(path).replace(/(\.circuit)?\.json$/, "")
} else {
  name = process.argv[2] ?? "finale"
  const Board = boards[name]
  if (!Board) throw new Error(`unknown board ${name}; use ${Object.keys(boards).join("|")}`)
  const circuit = new RootCircuit()
  circuit.add(<Board />)
  await circuit.renderUntilSettled()
  circuitJson = circuit.getCircuitJson()
}

const specId = fullId[name]
const spec = [...specs, finale].find((s) => s._id === specId)
const result = specId ? await runChecks(circuitJson, loadExpected(specId), { board_id: name, harness_version: 0 }) : undefined
const d = await buildDeliverables({ circuitJson, name, specId, specText: spec?.text, result })

const dir = `out/${name}`
rmSync(dir, { recursive: true, force: true })
for (const [path, data] of Object.entries(d.files)) {
  mkdirSync(dirname(`${dir}/${path}`), { recursive: true })
  writeFileSync(`${dir}/${path}`, data)
}
writeFileSync(`out/${name}-deliverables.zip`, zipDeliverables(d, name))
writeFileSync(`out/${name}-gerbers.zip`, zipFabrication(d))

for (const f of d.manifest.files) console.log(`  ${f.category.padEnd(12)} ${f.path.padEnd(36)} ${(f.bytes / 1024).toFixed(1).padStart(7)} KB`)
for (const s of d.skipped) console.log(`  SKIPPED ${s.path}: ${s.reason}`)
if (result) console.log(`checks: ${result.passed ? "passed" : `FAILED (${result.failures.length})`}`)
console.log(`wrote ${dir}/, out/${name}-deliverables.zip, out/${name}-gerbers.zip`)
process.exit(d.skipped.length ? 1 : 0)
