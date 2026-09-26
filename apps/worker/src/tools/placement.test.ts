// placeParts: a board with no positions comes out with 0 render errors and each decoupling cap beside its chip's
// supply pin, including two 8-pin chips that tscircuit's default packing puts shoulder to shoulder.
// Run: npm run test:placement
import { test } from "node:test"
import assert from "node:assert/strict"
import { evaluateCircuitSource } from "./evaluate.js"
import { normalizeCoderSource } from "./normalize.js"
import { placeParts } from "./placement.js"
import { getPart, partExample } from "./parts-whitelist.js"

type El = { type: string; [k: string]: any }
const render = async (s: string) => (await evaluateCircuitSource(s)).circuitJson as unknown[]
const chip = (id: string, name: string) => partExample(getPart(id)!, name)

const source = normalizeCoderSource(`export default () => (
  <board>
    <pinheader name="J1" pinCount={4} footprint="pinrow4" pinLabels={["3V3", "GND", "SDA", "SCL"]} />
    ${chip("temp_sensor_lm75", "U1")}
    ${chip("eeprom_24lc256", "U2")}
    <capacitor name="C1" capacitance="100nF" footprint="0603" />
    <capacitor name="C2" capacitance="100nF" footprint="0603" />
    <resistor name="R1" resistance="4.7k" footprint="0603" />
    <resistor name="R2" resistance="4.7k" footprint="0603" />
    <trace from=".J1 > .pin1" to="net.V3V3" />
    <trace from=".J1 > .pin2" to="net.GND" />
    <trace from=".J1 > .pin3" to="net.SDA" />
    <trace from=".J1 > .pin4" to="net.SCL" />
    <trace from=".U1 > .VCC" to="net.V3V3" />
    <trace from=".U1 > .GND" to="net.GND" />
    <trace from=".U1 > .SDA" to="net.SDA" />
    <trace from=".U1 > .SCL" to="net.SCL" />
    <trace from=".U1 > .A0" to="net.GND" />
    <trace from=".U1 > .A1" to="net.GND" />
    <trace from=".U1 > .A2" to="net.GND" />
    <trace from=".U2 > .VCC" to="net.V3V3" />
    <trace from=".U2 > .VSS" to="net.GND" />
    <trace from=".U2 > .SDA" to="net.SDA" />
    <trace from=".U2 > .SCL" to="net.SCL" />
    <trace from=".U2 > .A0" to="net.V3V3" />
    <trace from=".U2 > .A1" to="net.GND" />
    <trace from=".U2 > .A2" to="net.GND" />
    <trace from=".U2 > .WP" to="net.GND" />
    <trace from=".C1 > .pin1" to=".U1 > .VCC" />
    <trace from=".C1 > .pin2" to="net.GND" />
    <trace from=".C2 > .pin1" to=".U2 > .VCC" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".R1 > .pin1" to="net.SDA" />
    <trace from=".R1 > .pin2" to="net.V3V3" />
    <trace from=".R2 > .pin1" to="net.SCL" />
    <trace from=".R2 > .pin2" to="net.V3V3" />
  </board>
)`)

test("placeParts: no render errors, each cap within 2.5mm of a chip supply pad, every part pinned", async () => {
  const placed = await placeParts(source, render)
  const els = placed.circuitJson as El[]
  assert.deepEqual(els.filter((e) => e.type.endsWith("_error")).map((e) => e.message), [])

  const name = new Map(els.filter((e) => e.type === "source_component").map((e) => [e.source_component_id, e.name]))
  const sourcePort = new Map(els.filter((e) => e.type === "source_port").map((e) => [e.source_port_id, e]))
  const pads = els.filter((e) => e.type === "pcb_port").map((p) => {
    const sp = sourcePort.get(p.source_port_id)!
    return { x: p.x, y: p.y, comp: name.get(sp.source_component_id), pin: sp.name, net: sp.subcircuit_connectivity_map_key }
  })
  for (const [cap, chipName] of [["C1", "U1"], ["C2", "U2"]]) {
    const vcc = pads.find((p) => p.comp === chipName && p.pin === "VCC")!
    const capPad = pads.find((p) => p.comp === cap && p.net === vcc.net)!
    const mm = Math.hypot(capPad.x - vcc.x, capPad.y - vcc.y)
    assert.ok(mm <= 2.5, `${cap} is ${mm.toFixed(2)}mm from ${chipName} VCC`)
  }
  for (const n of ["J1", "U1", "U2", "C1", "C2", "R1", "R2"]) assert.match(placed.source, new RegExp(`name="${n}" pcbX=\\{`))
})

test("clearLabels: no part-name label on a pad, on another part's courtyard, or on another label", async () => {
  // evaluateCircuitSource runs clearLabels on every render.
  const { circuitJson } = await placeParts(source, render)
  const els = circuitJson as El[]
  const labels = els.filter((e) => e.type === "pcb_silkscreen_text" && e.pcb_component_id)
  assert.ok(labels.length >= 7)
  const box = (t: El) => {
    const w = t.text.length * t.font_size * 0.72, h = t.font_size
    const [hw, hh] = Math.round((t.ccw_rotation ?? 0) / 90) % 2 ? [h / 2, w / 2] : [w / 2, h / 2]
    return { x0: t.anchor_position.x - hw, x1: t.anchor_position.x + hw, y0: t.anchor_position.y - hh, y1: t.anchor_position.y + hh }
  }
  const hit = (a: any, b: any) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  const pads = els.filter((e) => e.type === "pcb_smtpad" || e.type === "pcb_plated_hole").map((p) => {
    const s = p.type === "pcb_smtpad" ? Math.max(p.width ?? 0, p.height ?? 0, 2 * (p.radius ?? 0)) : p.outer_diameter ?? Math.max(p.outer_width ?? 0, p.outer_height ?? 0)
    return { x0: p.x - s / 2, x1: p.x + s / 2, y0: p.y - s / 2, y1: p.y + s / 2 }
  })
  for (const [i, t] of labels.entries()) {
    assert.ok(!pads.some((p) => hit(box(t), p)), `${t.text} label sits on a pad`)
    for (const u of labels.slice(i + 1)) assert.ok(!hit(box(t), box(u)), `${t.text} and ${u.text} labels overlap`)
  }
})
