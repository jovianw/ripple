// Every spec in specs/specs.json has expected checks and a reference board that passes them.
// The second block feeds the rendered references wrong expectations to prove each new rule fails clearly.
// Run: npm run test:checks
import { test, describe, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import type { AnyCircuitElement } from "circuit-json"
import { runChecks, loadExpected } from "./index.ts"
import type { ExpectedChecks } from "./expected.ts"
import { renderBoard } from "./fixtures/render.tsx"
import { referenceBoards } from "./reference/index.ts"
import { H04Reference } from "./reference/h04_dual_led_driver.tsx"

const specs = JSON.parse(readFileSync("specs/specs.json", "utf8")) as { _id: string; split: string }[]
const rendered = new Map<string, AnyCircuitElement[]>()
const json = (id: string) => rendered.get(id)!
const details = (r: { failures: { check: string; detail: string }[] }, check: string) => r.failures.filter((f) => f.check === check).map((f) => f.detail).join("\n")

describe("reference boards pass their spec's checks", () => {
  before(async () => {
    for (const s of specs) rendered.set(s._id, await renderBoard(referenceBoards[s._id]))
  })
  for (const s of specs) {
    test(`${s._id} (${s.split})`, async () => {
      assert.ok(referenceBoards[s._id], `no reference board for ${s._id}`)
      const r = await runChecks(json(s._id), loadExpected(s._id), { board_id: s._id })
      assert.deepEqual(r.failures, [])
      assert.equal(r.passed, true)
      assert.equal(r.drc_errors, 0)
    })
  }
})

describe("new rules fail with clear details", () => {
  const run = (id: string, e: ExpectedChecks) => runChecks(json(id), e)

  test("between: missing part, wrong value, wrong count, reversed LED", async () => {
    let r = await run("t02_usbc_power_led", { between: [{ label: "VBUS bleeder", kind: "resistor", a: "J1.VBUS1", b: "J1.GND1" }] })
    assert.match(details(r, "between"), /VBUS bleeder: no resistor between J1\.VBUS1 and J1\.GND1/)
    r = await run("t02_usbc_power_led", { between: [{ label: "CC1 pull-down", kind: "resistor", a: "J1.CC1", b: "J1.GND1", min_ohms: 1000, max_ohms: 2000 }] })
    assert.match(details(r, "between"), /R1=5\.1k ohm, outside >= 1k and <= 2k/)
    r = await run("t02_usbc_power_led", { between: [{ label: "CC1 pull-down", kind: "resistor", a: "J1.CC1", b: "J1.GND1", count: 2 }] })
    assert.match(details(r, "between"), /expected exactly 2 resistor\(s\).*found 1 \(R1\)/)
    r = await run("t01_led_indicator", { between: [{ label: "LED", kind: "led", a: "J1.GND", b: "R1.pin2" }] })
    assert.match(details(r, "between"), /LED1 is reversed/)
  })

  test("series_led: wrong resistor window, reversed LED, wrong count, shared resistor", async () => {
    let r = await run("t01_led_indicator", { series_led: [{ label: "LED", rail: "J1.5V", gnd: "J1.GND", min_ohms: 2000, max_ohms: 3000 }] })
    assert.match(details(r, "series_led"), /LED1 series resistor R1=1k ohm is outside >= 2k and <= 3k/)
    r = await run("t01_led_indicator", { series_led: [{ label: "LED", rail: "J1.GND", gnd: "J1.5V" }] })
    assert.match(details(r, "series_led"), /LED1 is reversed/)
    r = await run("h04_dual_led_driver", { series_led: [{ label: "LED_A", rail: "J1.LED_A", gnd: "J1.GND", count: 2 }] })
    assert.match(details(r, "series_led"), /expected exactly 2 LED\(s\).*found 1 \(LED2\)/)
    const shared = await renderBoard(() => <H04Reference sharedResistor />)
    r = await runChecks(shared, loadExpected("h04_dual_led_driver"))
    assert.equal(r.passed, false)
    assert.match(details(r, "series_led"), /LED2 shares its series resistor R2 with LED3/)
    assert.match(details(r, "separate"), /J1\.LED_A and J1\.LED_B are shorted/)
  })

  test("tied: pin on the wrong rail, floating pin", async () => {
    let r = await run("t04_i2c_temp_breakout", { tied: [{ pin: "U1.A0", to: ["J1.3V3"] }] })
    assert.match(details(r, "tied"), /U1\.A0 is on GND, not one of J1\.3V3/)
    r = await run("t04_i2c_temp_breakout", { tied: [{ pin: "U1.OS", to: ["J1.GND", "J1.3V3"] }] })
    assert.match(details(r, "tied"), /U1\.OS is floating/)
  })

  test("divider: output out of range, total too low, missing leg", async () => {
    let r = await run("t05_divider_12v_adc", { divider: [{ label: "div", top: "J1.12V", bottom: "J1.GND", out: "J2.ADC", vin: 12, vout_min: 4.9, vout_max: 5.1, min_total_ohms: 100000 }] })
    assert.match(details(r, "divider"), /R1=30k over R2=10k gives 3\.00V at 12V in, outside 4\.9-5\.1V/)
    assert.match(details(r, "divider"), /total 40k ohm is below 100k/)
    r = await run("t05_divider_12v_adc", { divider: [{ label: "div", top: "J1.GND", bottom: "J1.12V", out: "J2.ADC", vin: 12, vout_min: 0, vout_max: 12 }] })
    assert.equal(r.passed, true)
    r = await run("t01_led_indicator", { divider: [{ label: "div", top: "J1.5V", bottom: "J1.GND", out: "R1.pin2", vin: 5, vout_min: 0, vout_max: 5 }] })
    assert.match(details(r, "divider"), /no resistor between R1\.pin2 and J1\.GND/)
  })

  test("rc_lowpass: cutoff and tau windows, missing cap", async () => {
    let r = await run("h03_rc_lowpass", { rc_lowpass: [{ label: "lp", in: "J1.IN", out: "J2.OUT", gnd: "J1.GND", min_cutoff_hz: 5000 }] })
    assert.match(details(r, "rc_lowpass"), /R1=1\.6k ohm, C1=100nF: tau=0\.16ms, cutoff=995Hz; cutoff outside 5000-InfinityHz/)
    r = await run("t06_button_debounced", { rc_lowpass: [{ label: "db", in: { any_pin_of: "SW1", except: ["J1.GND"] }, out: "J1.BTN", gnd: "J1.GND", min_tau_s: 0.05 }] })
    assert.match(details(r, "rc_lowpass"), /tau=10\.00ms.*tau outside 50-Infinityms/)
    r = await run("t05_divider_12v_adc", { rc_lowpass: [{ label: "lp", in: "J1.12V", out: "J2.ADC", gnd: "J1.GND" }] })
    assert.match(details(r, "rc_lowpass"), /no capacitor from J2\.ADC to J1\.GND/)
  })

  test("addresses: collision and untied pin", async () => {
    let r = await run("t08_i2c_two_devices", { distinct_addresses: [{ label: "addr", high: "J1.3V3", low: "J1.GND", devices: [{ chip: "U1", base: 0x48, pins: ["A2", "A1", "A0"] }, { chip: "U2", base: 0x48, pins: ["A2", "A1"] }] }] })
    assert.match(details(r, "addresses"), /U2 and U1 both answer at 0x48/)
    r = await run("t04_i2c_temp_breakout", { distinct_addresses: [{ label: "addr", high: "J1.3V3", low: "J1.GND", devices: [{ chip: "U1", base: 0x48, pins: ["OS"] }] }] })
    assert.match(details(r, "addresses"), /U1\.OS is not tied to J1\.3V3 or J1\.GND/)
  })

  test("wildcard net refs report clearly when nothing matches", async () => {
    const r = await run("t01_led_indicator", { series_led: [{ label: "gpio LED", rail: { any_pin_of: "U9" }, gnd: "J1.GND" }] })
    assert.match(details(r, "series_led"), /no component named U9/)
  })
})
