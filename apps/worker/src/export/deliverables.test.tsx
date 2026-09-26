// Deliverables: the finale reference exports every file type, with valid headers and sourced parts.
// Run: npm run test:export
import { test } from "node:test"
import assert from "node:assert/strict"
import { RootCircuit } from "tscircuit"
import { FinaleReference } from "../../../../checks/reference/finale.tsx"
import { buildDeliverables, zipDeliverables, zipFabrication } from "./deliverables.ts"

test("finale exports every deliverable", async () => {
  const c = new RootCircuit()
  c.add(<FinaleReference />)
  await c.renderUntilSettled()
  const d = await buildDeliverables({ circuitJson: c.getCircuitJson(), name: "finale", specId: "finale", source: "export default () => null" })
  assert.deepEqual(d.skipped, [])

  const paths = Object.keys(d.files)
  for (const p of ["fabrication/finale-F_Cu.gbr", "fabrication/finale-B_Cu.gbr", "fabrication/finale-Edge_Cuts.gbr", "fabrication/finale-drill-L1-L2.drl",
    "assembly/bom.csv", "assembly/pnp.csv", "assembly/assembly.svg", "kicad/finale.kicad_pro", "kicad/finale.kicad_sch", "kicad/finale.kicad_pcb",
    "3d/finale.glb", "images/pcb.svg", "images/pcb.png", "images/schematic.svg", "images/schematic.png", "netlist.csv",
    "simulation/finale.cir", "design/circuit.json", "design/finale.tsx", "report.md", "report.json", "manifest.json"]) {
    assert.ok(paths.includes(p), `missing ${p}`)
  }
  for (const [p, text] of Object.entries(d.files)) {
    if (p.endsWith(".gbr")) assert.match(text as string, /M02\*\s*$/, `${p} has no end-of-file marker`)
  }
  assert.match(d.files["assembly/bom.csv"] as string, /"U2","ATtiny85-20SU"/)
  assert.match(d.files["netlist.csv"] as string, /"V3V3",".*U3\.VCC/)
  assert.doesNotMatch(d.files["netlist.csv"] as string, /R\d+\.(anode|cathode)/)
  assert.deepEqual(d.manifest.files.map((f) => f.path).sort(), paths.sort())
  assert.equal(d.manifest.metrics.components, 20)
  assert.ok(zipDeliverables(d, "finale").byteLength > 0)
  assert.equal(Object.keys(d.files).filter((p) => p.startsWith("fabrication/")).length > 0 && zipFabrication(d).byteLength > 0, true)
})
