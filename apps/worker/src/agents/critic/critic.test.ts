// Critic inputs: the layout it gets from a render, and the prompt section it lands in. Run: npm run test:critic
import { test } from "node:test"
import assert from "node:assert/strict"
import { evaluateCircuitSource } from "../../tools/evaluate.js"
import { normalizeCoderSource } from "../../tools/normalize.js"
import { describeLayout } from "./layout.js"
import { criticUserPrompt } from "./prompt.js"

const BOARD = `export default () => (
  <board>
    <chip name="U1" footprint="soic8" pcbX={-5} pcbY={3}
      pinLabels={{ pin1: "SDA", pin2: "SCL", pin3: "OS", pin4: "GND", pin5: "A2", pin6: "A1", pin7: "A0", pin8: "VCC" }} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" />
    <trace from=".U1 > .VCC" to=".C1 > .pin1" />
    <trace from=".U1 > .GND" to=".C1 > .pin2" />
  </board>
)`

test("describeLayout gives each part's centre, placement, courtyard and supply pads", async () => {
  const { circuitJson } = await evaluateCircuitSource(normalizeCoderSource(BOARD))
  const layout = describeLayout(circuitJson)
  const u1 = layout.split("\n").find((l) => l.startsWith("- U1:"))
  const c1 = layout.split("\n").find((l) => l.startsWith("- C1:"))
  assert.ok(u1 && c1, layout)
  assert.match(u1, /centre \(-5, 3\), fixed by the code/)
  // A chip lists only its supply/ground pads; VCC is pin 8, a corner of the SOIC-8, not its centre.
  assert.match(u1, /VCC pin8 \(-2\.\d+, 4\.\d+\)/)
  assert.match(u1, /GND pin4 \(-7\.\d+, 1\.\d+\)/)
  assert.doesNotMatch(u1, /SDA/)
  assert.match(u1, /courtyard x -?[\d.]+\.\.-?[\d.]+, y/)
  assert.match(c1, /no pcbX\/pcbY in the code; courtyard .*; pads pin1 \(.+\), pin2 \(.+\)/)
})

test("describeLayout is empty when there is no render", () => {
  assert.equal(describeLayout(undefined), "")
})

test("normalizeCoderSource collapses pcbX={{12}} to pcbX={12}", () => {
  const out = normalizeCoderSource(`<capacitor name="C3" pcbX={{12}} pcbY={{ -1.5 }} pcbRotation={{90}} />`)
  assert.match(out, /pcbX=\{12\} pcbY=\{-1\.5\} pcbRotation=\{90\}/)
})

test("the critic prompt carries the layout, or says the code didn't render", () => {
  const base = {
    spec: { _id: "t04", text: "spec", split: "train" as const },
    code: "export default () => <board />",
    result: { board_id: "b", harness_version: 0, stage: "checks" as const, passed: false, failures: [], drc_errors: 0, ts: "" },
    lessons: [],
    rules: [],
    attempt: 1,
    repairBudget: 3,
  }
  assert.match(criticUserPrompt({ ...base, layout: "- U1: centre (0, 0)" }), /## Layout\n- U1: centre \(0, 0\)/)
  assert.match(criticUserPrompt(base), /## Layout\n\(the code did not render\)/)
})
