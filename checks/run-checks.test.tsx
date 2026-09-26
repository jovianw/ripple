// Proves the hidden checker: good boards pass, deliberately broken boards fail with clear details.
// Run: npm run test:checks
import { test, describe, before } from "node:test"
import assert from "node:assert/strict"
import type { AnyCircuitElement } from "circuit-json"
import { runChecks } from "./index.ts"
import type { ExpectedChecks } from "./expected.ts"
import { renderBoard } from "./fixtures/render.tsx"
import { LedBoard, LedBoardMissingTrace } from "./fixtures/led-board.tsx"
import { I2cBoard } from "./fixtures/i2c-board.tsx"

const ledExpected: ExpectedChecks = {
  nets: [
    { name: "VCC", pins: ["J1.VCC", "R1.pin1"] },
    { name: "LED_ANODE", pins: ["R1.pin2", "LED1.anode"] },
    { name: "GND", pins: ["LED1.cathode", "J1.GND"] },
  ],
  separate: [["J1.VCC", "J1.GND"]],
}

const i2cExpected: ExpectedChecks = {
  nets: [
    { name: "VCC", pins: ["U1.VCC", "U2.VDD", "C1.pin1", "C2.pin1"] },
    { name: "GND", pins: ["U1.GND", "U2.GND", "C1.pin2", "C2.pin2"] },
    { name: "SDA", pins: ["U1.SDA", "U2.SDA"] },
    { name: "SCL", pins: ["U1.SCL", "U2.SCL"] },
  ],
  separate: [["VCC", "GND"], ["SDA", "SCL"]],
  i2c: [{ sda: "SDA", scl: "SCL", vcc: "VCC", min_ohms: 1000, max_ohms: 10000 }],
  decoupling: [
    { chip: "U1", power_pin: "VCC", ground: "GND", max_mm: 3, min_farads: 1e-7 },
    { chip: "U2", power_pin: "VDD", ground: "GND", max_mm: 3 },
  ],
}

const failureChecks = (r: { failures: { check: string }[] }) => [...new Set(r.failures.map((f) => f.check))]
// The netlist rules (everything but drc) are deterministic; drc can pick up autorouter noise on a re-render.
const netlistChecks = (r: { failures: { check: string }[] }) => failureChecks(r).filter((c) => c !== "drc")
const detailsOf = (r: { failures: { check: string; detail: string }[] }, check: string) =>
  r.failures.filter((f) => f.check === check).map((f) => f.detail)

describe("LED board", () => {
  let json: AnyCircuitElement[]
  before(async () => { json = await renderBoard(LedBoard) })

  test("passes connectivity and DRC and fills RunResult", async () => {
    const r = await runChecks(json, ledExpected, { board_id: "led", harness_version: 0 })
    assert.deepEqual(r.failures, [])
    assert.equal(r.passed, true)
    assert.equal(r.drc_errors, 0)
    assert.equal(r.board_id, "led")
    assert.equal(r.harness_version, 0)
    assert.equal(r.stage, "checks")
    assert.ok(!Number.isNaN(Date.parse(r.ts)))
  })

  test("fails connectivity when a source trace is dropped", async () => {
    const broken = await renderBoard(LedBoardMissingTrace)
    const r = await runChecks(broken, ledExpected)
    assert.equal(r.passed, false)
    assert.ok(failureChecks(r).includes("connectivity"))
    const d = detailsOf(r, "connectivity").join("\n")
    assert.match(d, /LED_ANODE/)
    assert.match(d, /R1\.pin2/)
    assert.match(d, /LED1\.anode/)
  })

  test("fails DRC when a routed trace is removed from the Circuit JSON", async () => {
    const unrouted = json.filter((e) => !(e.type === "pcb_trace" && (e as { connection_name?: string }).connection_name === "source_trace_1"))
    const r = await runChecks(unrouted, ledExpected)
    assert.equal(r.passed, false)
    assert.ok(r.drc_errors > 0)
    assert.ok(failureChecks(r).includes("drc"))
    assert.ok(detailsOf(r, "drc").length > 0)
    // Connectivity is a netlist property, so it still holds.
    assert.ok(!failureChecks(r).includes("connectivity"))
  })

  test("reports a missing pin reference clearly instead of crashing", async () => {
    const r = await runChecks(json, { nets: [{ name: "X", pins: ["J1.VCC", "U9.VCC"] }] })
    assert.equal(r.passed, false)
    assert.match(detailsOf(r, "connectivity").join("\n"), /U9\.VCC/)
    assert.match(detailsOf(r, "connectivity").join("\n"), /not found|no component/i)
  })

  test("fails when a required named net does not exist", async () => {
    const r = await runChecks(json, { nets: [{ name: "SDA" }] })
    assert.equal(r.passed, false)
    assert.match(detailsOf(r, "connectivity").join("\n"), /SDA/)
  })
})

describe("I2C board", () => {
  let json: AnyCircuitElement[]
  before(async () => { json = await renderBoard(I2cBoard) })

  test("passes all checks", async () => {
    const r = await runChecks(json, i2cExpected)
    assert.deepEqual(r.failures, [])
    assert.equal(r.passed, true)
    assert.equal(r.drc_errors, 0)
  })

  test("fails pullups when the SCL pull-up is removed", async () => {
    const broken = await renderBoard(() => <I2cBoard noSclPullup />)
    const r = await runChecks(broken, i2cExpected)
    assert.equal(r.passed, false)
    assert.deepEqual(netlistChecks(r), ["pullups"])
    const d = detailsOf(r, "pullups").join("\n")
    assert.match(d, /SCL/)
    assert.match(d, /VCC/)
    assert.doesNotMatch(d, /SDA/)
  })

  test("fails pullups when the resistance is out of range", async () => {
    const broken = await renderBoard(() => <I2cBoard pullupOhms="100k" />)
    const r = await runChecks(broken, i2cExpected)
    assert.equal(r.passed, false)
    assert.deepEqual(netlistChecks(r), ["pullups"])
    assert.match(detailsOf(r, "pullups").join("\n"), /100k/)
  })

  test("fails decoupling when the cap is moved away from U1", async () => {
    const broken = await renderBoard(() => <I2cBoard u1CapOffsetMm={6} />)
    const r = await runChecks(broken, i2cExpected)
    assert.equal(r.passed, false)
    assert.deepEqual(netlistChecks(r), ["decoupling"])
    const d = detailsOf(r, "decoupling").join("\n")
    assert.match(d, /U1 VCC/)
    assert.match(d, /3mm/)
    assert.match(d, /C1/)
  })

  test("fails decoupling and connectivity when U1's cap is removed", async () => {
    const broken = await renderBoard(() => <I2cBoard noU1Cap />)
    const r = await runChecks(broken, i2cExpected)
    assert.equal(r.passed, false)
    assert.ok(failureChecks(r).includes("decoupling"))
    assert.match(detailsOf(r, "decoupling").join("\n"), /U1 VCC has no/)
    // C1 is also listed in the expected nets, so connectivity reports it missing.
    assert.match(detailsOf(r, "connectivity").join("\n"), /C1/)
  })

  test("fails decoupling when min_farads is not met", async () => {
    const r = await runChecks(json, { decoupling: [{ chip: "U2", power_pin: "VDD", ground: "GND", min_farads: 1e-6 }] })
    assert.equal(r.passed, false)
    assert.match(detailsOf(r, "decoupling").join("\n"), /U2 VDD/)
  })

  test("fails separate when VCC is shorted to GND", async () => {
    const broken = await renderBoard(() => <I2cBoard shortVccToGnd />)
    const r = await runChecks(broken, i2cExpected)
    assert.equal(r.passed, false)
    assert.ok(failureChecks(r).includes("separate"))
    assert.match(detailsOf(r, "separate").join("\n"), /VCC.*GND|GND.*VCC/)
  })
})
