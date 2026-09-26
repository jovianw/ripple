// Planner: config knobs, validation + retry + fallback, replans, and the interface check.
// Run: npm run test:planner
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { RootCircuit } from "tscircuit"
import finaleSpec from "../../../../../specs/finale.json" with { type: "json" }
import { FinaleSensors } from "../../../../../checks/reference/finale.tsx"
import { plan, validatePlan, specHeaders, checkInterface, type PlannerOutput, type SubcircuitPayload } from "./index.ts"

const cfg = (plan_first: boolean, split_over_parts = 12) => ({ workflow: { plan_first, repair_budget: 3, split_over_parts } })
const spec = { _id: "finale", text: finaleSpec.text }
const base = { spec, rules: [], library: [] }

const finalePlan: PlannerOutput = {
  summary: "power, mcu, sensors",
  nets: [
    { name: "V3V3", kind: "power", description: "3.3V rail" },
    { name: "GND", kind: "ground", description: "ground" },
    { name: "SDA", kind: "bus", description: "I2C data" },
    { name: "SCL", kind: "bus", description: "I2C clock" },
  ],
  subcircuits: [
    { key: "power", title: "USB-C to 3.3V", purpose: "USB-C sink, LDO, power LED", depends_on: [], headers: [], reuse_subcircuit_id: "", nets: ["V3V3", "GND"],
      parts: [{ part: "usb_c_receptacle", qty: 1, for: "input" }, { part: "resistor_0603", qty: 3, for: "CC, LED" }, { part: "ldo_3v3_ap2112k", qty: 1, for: "reg" }, { part: "capacitor_0603", qty: 2, for: "LDO" }, { part: "led_0603", qty: 1, for: "power" }] },
    { key: "mcu", title: "ATtiny85 + ISP", purpose: "MCU, reset, status LED, ISP", depends_on: ["power"], headers: [0], reuse_subcircuit_id: "", nets: ["V3V3", "GND", "SDA", "SCL"],
      parts: [{ part: "mcu_attiny85", qty: 1, for: "mcu" }, { part: "capacitor_0603", qty: 1, for: "decoupling" }, { part: "resistor_0603", qty: 2, for: "reset, LED" }, { part: "led_0603", qty: 1, for: "status" }, { part: "header_6", qty: 1, for: "ISP" }] },
    { key: "sensors", title: "LM75 + SHT40", purpose: "two I2C sensors with pull-ups", depends_on: ["power"], headers: [], reuse_subcircuit_id: "", nets: ["V3V3", "GND", "SDA", "SCL"],
      parts: [{ part: "temp_sensor_lm75", qty: 1, for: "temp" }, { part: "humidity_sensor_sht40", qty: 1, for: "humidity" }, { part: "capacitor_0603", qty: 2, for: "decoupling" }, { part: "resistor_0603", qty: 2, for: "pull-ups" }] },
  ],
}

/** Fake model: returns the queued outputs in order and records the prompts it saw. */
const fake = (...outs: PlannerOutput[]) => {
  const prompts: string[] = []
  return { prompts, deps: { async complete(_s: string, user: string) { prompts.push(user); return structuredClone(outs.shift()!) } } }
}

describe("planner", () => {
  test("reads header labels from spec text", () => {
    assert.deepEqual(specHeaders(finaleSpec.text), [{ pins: 6, labels: ["MISO", "VCC", "SCK", "MOSI", "RESET", "GND"] }])
  })

  test("plan_first off: one item, no model call", async () => {
    const f = fake()
    const p = await plan(base, cfg(false), f.deps)
    assert.equal(f.prompts.length, 0)
    assert.deepEqual(p.items.map((i) => i.key), ["board"])
  })

  test("valid split: one item per subcircuit plus assemble", async () => {
    const p = await plan(base, cfg(true), fake(finalePlan).deps)
    assert.deepEqual(p.items.map((i) => i.key), ["power", "mcu", "sensors", "assemble"])
    assert.deepEqual(p.items.at(-1)!.depends_on, ["power", "mcu", "sensors"])
    assert.deepEqual((p.items[1].payload as unknown as SubcircuitPayload).headers[0].labels[0], "MISO")
  })

  test("small plans collapse to one item (split_over_parts)", async () => {
    const p = await plan(base, cfg(true, 30), fake(finalePlan).deps)
    assert.deepEqual(p.items.map((i) => i.key), ["board"])
  })

  test("invalid plan gets one retry with the errors", async () => {
    const bad = structuredClone(finalePlan)
    bad.subcircuits[1].headers = []
    bad.subcircuits[2].parts[0].part = "bmp390"
    const f = fake(bad, finalePlan)
    const p = await plan(base, cfg(true), f.deps)
    assert.equal(f.prompts.length, 2)
    assert.match(f.prompts[1], /header 0 \(MISO.*must belong to exactly one subcircuit/)
    assert.match(f.prompts[1], /part "bmp390" is not on the whitelist/)
    assert.equal(p.items.length, 4)
  })

  test("still invalid after retry: falls back to one item", async () => {
    const bad = structuredClone(finalePlan)
    bad.subcircuits[2].depends_on = ["mcu"]
    bad.subcircuits[1].depends_on = ["sensors"]
    const p = await plan(base, cfg(true), fake(bad, bad).deps)
    assert.deepEqual(p.items.map((i) => i.key), ["board"])
    assert.match(p.fallback_errors!.join("\n"), /dependency cycle/)
  })

  test("replan keeps done items, cancels replaced ones, renames assemble", async () => {
    const revised = structuredClone(finalePlan)
    revised.subcircuits[1].key = "mcu_v2"
    const previous = {
      items: [
        { key: "power", title: "", status: "done" as const },
        { key: "mcu", title: "", status: "failed" as const },
        { key: "sensors", title: "", status: "pending" as const },
        { key: "assemble", title: "", status: "pending" as const },
      ],
      escalation: { key: "mcu", reason: "cannot route ISP header" },
    }
    const p = await plan({ ...base, previous }, cfg(true), fake(revised).deps)
    assert.deepEqual(p.items.map((i) => i.key), ["mcu_v2", "sensors", "assemble_r1"])
    assert.deepEqual(p.cancel.sort(), ["assemble", "mcu"])
  })

  test("replan that drops a done item is invalid", () => {
    const errors = validatePlan({ ...finalePlan, subcircuits: finalePlan.subcircuits.slice(1).map((s) => ({ ...s, depends_on: [] })) },
      specHeaders(finaleSpec.text), { items: [{ key: "power", title: "", status: "done" }], escalation: { key: "mcu", reason: "" } })
    assert.match(errors.join("\n"), /done item "power" was dropped/)
  })

  test("interface check: the finale sensors group matches its plan", async () => {
    const c = new RootCircuit()
    c.add(<board width="30mm" height="20mm"><FinaleSensors /></board>)
    await c.renderUntilSettled()
    const payload: SubcircuitPayload = { kind: "subcircuit", purpose: "", parts: finalePlan.subcircuits[2].parts, nets: ["V3V3", "GND", "SDA", "SCL"], headers: [], reuse_subcircuit_id: "" }
    assert.deepEqual(checkInterface(payload, c.getCircuitJson() as any), [])
    const wrong = { ...payload, nets: [...payload.nets, "VBUS"], parts: payload.parts.filter((p) => p.part !== "humidity_sensor_sht40") }
    const problems = checkInterface(wrong, c.getCircuitJson() as any).join("\n")
    assert.match(problems, /planned shared net VBUS is missing/)
    assert.match(problems, /SHT40-AD1B is not in this subcircuit's plan/)
  })
})
