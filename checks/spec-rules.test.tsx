// Proves the per-spec expected checks: correct boards pass whatever the parts are named,
// and each common first-board mistake fails with a clear detail. Run: npm run test:checks
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import whitelist from "../parts/whitelist.json" with { type: "json" }
import { runChecks, loadExpected } from "./index.ts"
import { renderBoard } from "./fixtures/render.tsx"
import { T03Reference } from "./reference/t03_ldo_3v3.tsx"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const part = (id: string) => whitelist.parts.find((p) => p.id === id)!.props as any

async function grade(specId: string, Board: () => unknown) {
  const r = await runChecks(await renderBoard(Board as () => any), loadExpected(specId))
  return { r, checks: [...new Set(r.failures.map((f) => f.check))].filter((c) => c !== "drc"), text: r.failures.map((f) => `${f.check}: ${f.detail}`).join("\n") }
}

// ---- t01: LED indicator ----
const T01 = ({ r = "1k", reversed = false }: { r?: string; reversed?: boolean }) => () => (
  <board width="20mm" height="12mm">
    <pinheader name="PWR" pinCount={2} pinLabels={["5V", "GND"]} footprint="pinrow2" pcbX={-6} />
    <resistor name="Rled" resistance={r} footprint="0603" pcbX={0} />
    <led name="D9" color="red" footprint="0603" pcbX={5} />
    <trace from=".PWR > .pin1" to=".Rled > .pin1" />
    <trace from=".Rled > .pin2" to={reversed ? ".D9 > .cathode" : ".D9 > .anode"} />
    <trace from={reversed ? ".D9 > .anode" : ".D9 > .cathode"} to=".PWR > .pin2" />
  </board>
)

describe("t01_led_indicator", () => {
  test("correct board passes, with arbitrary part names", async () => {
    const { r, text } = await grade("t01_led_indicator", T01({}))
    assert.equal(r.passed, true, text)
  })
  test("220 ohm resistor fails the current window", async () => {
    const { checks, text } = await grade("t01_led_indicator", T01({ r: "220" }))
    assert.deepEqual(checks, ["leds"], text)
    assert.match(text, /D9 series resistor Rled=220 outside/)
  })
  test("reversed LED fails", async () => {
    const { checks, text } = await grade("t01_led_indicator", T01({ reversed: true }))
    assert.deepEqual(checks, ["leds"], text)
    assert.match(text, /reversed/)
  })
})

// ---- t03: USB-C + LDO ----
const T03BadCc = () => (
  <board width="26mm" height="18mm">
    <chip name="USB" {...part("usb_c_receptacle")} pcbX={-8} pcbY={2} pcbRotation={-90} />
    <resistor name="R1" resistance="5.1k" footprint="0603" pcbX={-3} pcbY={5} />
    <chip name="REG" {...part("ldo_3v3_ap2112k")} pcbX={3} pcbY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={-0.2} pcbY={1.2} pcbRotation={90} />
    <capacitor name="C2" capacitance="1uF" footprint="0603" pcbX={6.2} pcbY={1.2} pcbRotation={90} />
    <led name="LED1" color="green" footprint="0603" pcbX={6} pcbY={5} />
    <resistor name="R3" resistance="1k" footprint="0603" pcbX={2} pcbY={5} />
    <pinheader name="J2" pinCount={2} pinLabels={["3V3", "GND"]} footprint="pinrow2" pcbX={10} pcbY={0} pcbRotation={90} />
    <trace from=".USB > .VBUS1" to="net.VBUS" />
    <trace from=".USB > .VBUS2" to="net.VBUS" />
    <trace from=".USB > .GND1" to="net.GND" />
    <trace from=".USB > .GND2" to="net.GND" />
    {/* Classic mistake: one resistor shared by CC1 and CC2. */}
    <trace from=".USB > .CC1" to=".R1 > .pin1" />
    <trace from=".USB > .CC2" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".REG > .VIN" to="net.VBUS" />
    <trace from=".REG > .EN" to="net.VBUS" />
    <trace from=".REG > .GND" to="net.GND" />
    <trace from=".REG > .VOUT" to="net.V3" />
    <trace from=".C1 > .pin1" to="net.VBUS" />
    <trace from=".C1 > .pin2" to="net.GND" />
    <trace from=".C2 > .pin1" to="net.V3" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".R3 > .pin1" to="net.V3" />
    <trace from=".R3 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to="net.GND" />
    <trace from=".J2 > .pin1" to="net.V3" />
    <trace from=".J2 > .pin2" to="net.GND" />
  </board>
)

describe("t03_ldo_3v3", () => {
  test("reference board passes", async () => {
    const { r, text } = await grade("t03_ldo_3v3", T03Reference)
    assert.equal(r.passed, true, text)
  })
  test("shared CC resistor fails", async () => {
    const { checks, text } = await grade("t03_ldo_3v3", T03BadCc)
    assert.ok(checks.includes("separate"), text)
    assert.match(text, /CC1 and .*CC2 are shorted/)
  })
})

// ---- t04: I2C temperature breakout ----
const T04 = ({ pullups = true, tieA0 = true, capX = 3.5 }: { pullups?: boolean; tieA0?: boolean; capX?: number }) => () => (
  <board width="24mm" height="18mm">
    <chip name="TEMP" {...part("temp_sensor_lm75")} pcbX={0} pcbY={0} />
    <capacitor name="Cd" capacitance="100nF" footprint="0603" pcbX={capX} pcbY={2} pcbRotation={90} />
    {pullups && <resistor name="Rsda" resistance="4.7k" footprint="0603" pcbX={-6} pcbY={5} />}
    {pullups && <resistor name="Rscl" resistance="4.7k" footprint="0603" pcbX={-2} pcbY={5} />}
    <pinheader name="HDR" pinCount={4} pinLabels={["3V3", "GND", "SDA", "SCL"]} footprint="pinrow4" pcbX={0} pcbY={-6} />
    <trace from=".HDR > .pin1" to="net.V" />
    <trace from=".HDR > .pin2" to="net.G" />
    <trace from=".HDR > .pin3" to=".TEMP > .SDA" />
    <trace from=".HDR > .pin4" to=".TEMP > .SCL" />
    <trace from=".TEMP > .VCC" to="net.V" />
    <trace from=".TEMP > .GND" to="net.G" />
    <trace from=".Cd > .pin1" to=".TEMP > .VCC" />
    <trace from=".Cd > .pin2" to="net.G" />
    {tieA0 && <trace from=".TEMP > .A0" to="net.G" />}
    <trace from=".TEMP > .A1" to="net.G" />
    <trace from=".TEMP > .A2" to="net.G" />
    {pullups && <trace from=".Rsda > .pin1" to=".TEMP > .SDA" />}
    {pullups && <trace from=".Rsda > .pin2" to="net.V" />}
    {pullups && <trace from=".Rscl > .pin1" to=".TEMP > .SCL" />}
    {pullups && <trace from=".Rscl > .pin2" to="net.V" />}
  </board>
)

describe("t04_i2c_temp_breakout", () => {
  test("correct board passes", async () => {
    const { checks, text } = await grade("t04_i2c_temp_breakout", T04({}))
    assert.deepEqual(checks, [], text)
  })
  test("missing pull-ups fail", async () => {
    const { checks, text } = await grade("t04_i2c_temp_breakout", T04({ pullups: false }))
    assert.deepEqual(checks, ["pullups"], text)
  })
  test("floating address pin fails", async () => {
    const { checks, text } = await grade("t04_i2c_temp_breakout", T04({ tieA0: false }))
    assert.deepEqual(checks, ["tied"], text)
    assert.match(text, /TEMP\.A0 is floating/)
  })
  test("far decoupling cap fails", async () => {
    const { checks, text } = await grade("t04_i2c_temp_breakout", T04({ capX: 10 }))
    assert.deepEqual(checks, ["decoupling"], text)
  })
})

// ---- t05 / h03: analog ----
const Divider = (top: string, bottom: string) => () => (
  <board width="20mm" height="14mm">
    <pinheader name="IN" pinCount={2} pinLabels={["12V", "GND"]} footprint="pinrow2" pcbX={-7} />
    <pinheader name="OUT" pinCount={2} pinLabels={["ADC", "GND"]} footprint="pinrow2" pcbX={7} />
    <resistor name="Ra" resistance={top} footprint="0603" pcbX={0} pcbY={3} />
    <resistor name="Rb" resistance={bottom} footprint="0603" pcbX={0} pcbY={-3} />
    <trace from=".IN > .pin1" to=".Ra > .pin1" />
    <trace from=".Ra > .pin2" to=".OUT > .pin1" />
    <trace from=".Rb > .pin1" to=".OUT > .pin1" />
    <trace from=".Rb > .pin2" to=".IN > .pin2" />
    <trace from=".IN > .pin2" to=".OUT > .pin2" />
  </board>
)

const LowPass = (r: string) => () => (
  <board width="20mm" height="14mm">
    <pinheader name="J1" pinCount={2} pinLabels={["IN", "GND"]} footprint="pinrow2" pcbX={-7} />
    <pinheader name="J2" pinCount={2} pinLabels={["OUT", "GND"]} footprint="pinrow2" pcbX={7} />
    <resistor name="R1" resistance={r} footprint="0603" pcbX={0} pcbY={3} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={0} pcbY={-3} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".J2 > .pin1" />
    <trace from=".C1 > .pin1" to=".J2 > .pin1" />
    <trace from=".C1 > .pin2" to=".J1 > .pin2" />
    <trace from=".J1 > .pin2" to=".J2 > .pin2" />
  </board>
)

describe("analog", () => {
  test("t05: 30k over 10k passes", async () => {
    const { checks, text } = await grade("t05_divider_12v_adc", Divider("30k", "10k"))
    assert.deepEqual(checks, [], text)
  })
  test("t05: 10k over 10k (6V out) fails", async () => {
    const { checks, text } = await grade("t05_divider_12v_adc", Divider("10k", "10k"))
    assert.deepEqual(checks, ["divider"], text)
    assert.match(text, /ratio 0\.500/)
  })
  test("h03: 1.6k with 100nF (~1 kHz) passes", async () => {
    const { checks, text } = await grade("h03_rc_lowpass", LowPass("1.6k"))
    assert.deepEqual(checks, [], text)
  })
  test("h03: 16k with 100nF (~100 Hz) fails", async () => {
    const { checks, text } = await grade("h03_rc_lowpass", LowPass("16k"))
    assert.deepEqual(checks, ["rc"], text)
  })
})

// ---- h04: shared LED resistor ----
const DualLed = ({ shared }: { shared: boolean }) => () => (
  <board width="26mm" height="16mm">
    <pinheader name="J1" pinCount={4} pinLabels={["5V", "GND", "LED_A", "LED_B"]} footprint="pinrow4" pcbX={-9} />
    <resistor name="Rp" resistance="1k" footprint="0603" pcbX={-2} pcbY={5} />
    <led name="Dp" color="green" footprint="0603" pcbX={4} pcbY={5} />
    <resistor name="Ra" resistance="1k" footprint="0603" pcbX={-2} pcbY={0} />
    <led name="Da" color="red" footprint="0603" pcbX={4} pcbY={0} />
    {!shared && <resistor name="Rb" resistance="1k" footprint="0603" pcbX={-2} pcbY={-5} />}
    <led name="Db" color="red" footprint="0603" pcbX={4} pcbY={-5} />
    <trace from=".J1 > .pin1" to=".Rp > .pin1" />
    <trace from=".Rp > .pin2" to=".Dp > .anode" />
    <trace from=".Dp > .cathode" to=".J1 > .pin2" />
    <trace from=".J1 > .pin3" to=".Ra > .pin1" />
    <trace from=".Ra > .pin2" to=".Da > .anode" />
    <trace from=".Da > .cathode" to=".J1 > .pin2" />
    {shared ? <trace from=".Ra > .pin2" to=".Db > .anode" /> : <trace from=".J1 > .pin4" to=".Rb > .pin1" />}
    {!shared && <trace from=".Rb > .pin2" to=".Db > .anode" />}
    <trace from=".Db > .cathode" to=".J1 > .pin2" />
  </board>
)

describe("h04_dual_led_driver", () => {
  test("one resistor per LED passes", async () => {
    const { checks, text } = await grade("h04_dual_led_driver", DualLed({ shared: false }))
    assert.deepEqual(checks, [], text)
  })
  test("shared resistor fails", async () => {
    const { checks, text } = await grade("h04_dual_led_driver", DualLed({ shared: true }))
    assert.ok(checks.includes("leds"), text)
    assert.match(text, /shares resistor Ra/)
  })
})
