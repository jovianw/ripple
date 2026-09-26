// Generic checks for free-text specs: every known-good reference board passes them, and common mistakes fail.
// Run: npm run test:checks
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import whitelist from "../parts/whitelist.json" with { type: "json" }
import { runChecks, genericExpected, headerLabels } from "./index.ts"
import { renderBoard } from "./fixtures/render.tsx"
import { referenceBoards } from "./reference/index.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const part = (id: string) => whitelist.parts.find((p) => p.id === id)!.props as any
const grade = async (Board: () => unknown, text?: string) => {
  const json = await renderBoard(Board as () => any)
  const r = await runChecks(json, genericExpected(json, text))
  return { r, checks: [...new Set(r.failures.map((f) => f.check))].filter((c) => c !== "drc"), text: r.failures.map((f) => `${f.check}: ${f.detail}`).join("\n") }
}

describe("generic checks", () => {
  for (const [id, Board] of Object.entries(referenceBoards)) {
    test(`reference ${id} passes`, async () => {
      const { r, text } = await grade(Board)
      assert.equal(r.passed, true, text)
    })
  }

  test("reads header labels from free text", () => {
    assert.deepEqual(headerLabels("powered from a 4-pin header (3V3, GND, SDA, SCL) and a 2-pin header (IN, GND)"), ["3V3", "GND", "SDA", "SCL", "IN", "GND"])
  })

  const Sensor = ({ cap = true, pullups = true, led = "resistor" as "resistor" | "none" }) => () => (
    <board width="30mm" height="20mm">
      <chip name="S1" {...part("temp_sensor_lm75")} pcbX={0} pcbY={0} />
      {cap && <capacitor name="C9" capacitance="100nF" footprint="0603" pcbX={3.5} pcbY={2} pcbRotation={90} />}
      {pullups && <resistor name="RA" resistance="4.7k" footprint="0603" pcbX={-6} pcbY={5} />}
      {pullups && <resistor name="RB" resistance="4.7k" footprint="0603" pcbX={-2} pcbY={5} />}
      <led name="L1" color="green" footprint="0603" pcbX={8} pcbY={-5} />
      {led === "resistor" && <resistor name="RL" resistance="1k" footprint="0603" pcbX={4} pcbY={-5} />}
      <pinheader name="H" pinCount={4} pinLabels={["3V3", "GND", "SDA", "SCL"]} footprint="pinrow4" pcbX={0} pcbY={-8} />
      <trace from=".H > .pin1" to="net.V" /><trace from=".H > .pin2" to="net.G" />
      <trace from=".H > .pin3" to=".S1 > .SDA" /><trace from=".H > .pin4" to=".S1 > .SCL" />
      <trace from=".S1 > .VCC" to="net.V" /><trace from=".S1 > .GND" to="net.G" />
      <trace from=".S1 > .A0" to="net.G" /><trace from=".S1 > .A1" to="net.G" /><trace from=".S1 > .A2" to="net.G" />
      {cap && <trace from=".C9 > .pin1" to=".S1 > .VCC" />}{cap && <trace from=".C9 > .pin2" to="net.G" />}
      {pullups && <trace from=".RA > .pin1" to=".S1 > .SDA" />}{pullups && <trace from=".RA > .pin2" to="net.V" />}
      {pullups && <trace from=".RB > .pin1" to=".S1 > .SCL" />}{pullups && <trace from=".RB > .pin2" to="net.V" />}
      {led === "resistor" ? <trace from="net.V" to=".RL > .pin1" /> : <trace from="net.V" to=".L1 > .anode" />}
      {led === "resistor" && <trace from=".RL > .pin2" to=".L1 > .anode" />}
      <trace from=".L1 > .cathode" to="net.G" />
    </board>
  )

  test("a correct free-text board passes", async () => {
    const { checks, text } = await grade(Sensor({}), "an I2C temperature sensor on a 4-pin header (3V3, GND, SDA, SCL) with a power LED")
    assert.deepEqual(checks, [], text)
  })
  test("missing decoupling cap fails", async () => {
    const { checks, text } = await grade(Sensor({ cap: false }))
    assert.ok(checks.includes("decoupling"), text)
  })
  test("missing I2C pull-ups fail", async () => {
    const { checks, text } = await grade(Sensor({ pullups: false }))
    assert.ok(checks.includes("pullups"), text)
  })
  test("LED without a resistor fails", async () => {
    const { checks, text } = await grade(Sensor({ led: "none" }))
    assert.ok(checks.includes("leds"), text)
  })
  test("a header label the prompt names but the board lacks fails", async () => {
    const { checks, text } = await grade(Sensor({}), "a sensor on a header (3V3, GND, SDA, SCL, ALERT)")
    assert.ok(checks.includes("connectivity"), text)
    assert.match(text, /ALERT/)
  })
})
