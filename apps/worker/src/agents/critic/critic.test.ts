// Critic inputs: the layout it gets from a render, and the prompt section it lands in. Run: npm run test:critic
import { test } from "node:test"
import assert from "node:assert/strict"
import { evaluateCircuitSource } from "../../tools/evaluate.js"
import { keepPlacement, normalizeCoderSource } from "../../tools/normalize.js"
import { describeLayout } from "./layout.js"
import { settlePlacement } from "../../tools/placement.js"
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

test("a cap placed at the suggested clear spot renders without overlaps, next to the pad", async () => {
  const { circuitJson } = await evaluateCircuitSource(normalizeCoderSource(BOARD))
  const spot = describeLayout(circuitJson).match(/- U1 VCC: pcbX=\{(-?[\d.]+)\} pcbY=\{(-?[\d.]+)\}( pcbRotation=\{90\})?, centre ([\d.]+)mm/)
  assert.ok(spot, "a spot for U1 VCC")
  assert.ok(Number(spot[4]) < 2.5, `spot is ${spot[4]}mm from the pad`)
  const moved = BOARD.replace(
    `<capacitor name="C1"`,
    `<capacitor name="C1" pcbX={${spot[1]}} pcbY={${spot[2]}}${spot[3] ? " pcbRotation={90}" : ""}`,
  )
  const after = (await evaluateCircuitSource(normalizeCoderSource(moved))).circuitJson as { type: string }[]
  const errors = after.filter((e) => /overlap|clearance/.test(e.type)).map((e) => e.type)
  assert.deepEqual(errors, [])
})

test("keepPlacement restores a position the coder dropped, and leaves moved parts alone", () => {
  const previous = `<pinheader name="HEADER" pcbX={-5.67} pcbY={-4.91} pcbRotation={-90} pinCount={4} />
    <capacitor name="C2" pcbX={-5.38} pcbY={2.4} capacitance="100nF" />`
  const edited = `<pinheader name="HEADER" pinCount={4} />
    <capacitor name="C2" pcbX={3.8} pcbY={1.91} pcbRotation={90} capacitance="100nF" />
    <resistor name="R9" resistance="1k" />`
  const out = keepPlacement(edited, previous)
  assert.match(out, /<pinheader name="HEADER" pcbX=\{-5\.67\} pcbY=\{-4\.91\} pcbRotation=\{-90\} pinCount=\{4\} \/>/)
  assert.match(out, /<capacitor name="C2" pcbX=\{3\.8\} pcbY=\{1\.91\} pcbRotation=\{90\}/)
  assert.match(out, /<resistor name="R9" resistance="1k" \/>/)
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

test("settlePlacement fits parts a repair added, and leaves untouched parts where they were", async () => {
  const previous = `export default () => (
  <board>
    <chip name="U1" footprint="soic8" pcbX={0} pcbY={0}
      pinLabels={{ pin1: "SDA", pin2: "SCL", pin3: "OS", pin4: "GND", pin5: "A2", pin6: "A1", pin7: "A0", pin8: "VCC" }} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={5} pcbY={2} />
    <trace from=".U1 > .VCC" to=".C1 > .pin1" />
  </board>
)`
  // The repair drops R1 on top of U1 and adds R2 with no position at all.
  const repaired = previous.replace(
    `<trace from=".U1 > .VCC"`,
    `<resistor name="R1" resistance="4.7k" footprint="0603" pcbX={0} pcbY={0} />
    <resistor name="R2" resistance="4.7k" footprint="0603" />
    <trace from=".R1 > .pin1" to=".U1 > .SDA" />
    <trace from=".R2 > .pin1" to=".U1 > .SCL" />
    <trace from=".U1 > .VCC"`,
  )
  const errors = (cj: unknown) => (cj as { type: string }[]).filter((e) => /overlap|clearance/.test(e.type)).map((e) => e.type)
  const before = (await evaluateCircuitSource(repaired)).circuitJson
  assert.ok(errors(before).length > 0, "the repair's layout overlaps")

  const settled = settlePlacement(repaired, before, previous)
  const after = (await evaluateCircuitSource(settled)).circuitJson
  assert.deepEqual(errors(after), [])
  assert.match(settled, /<chip name="U1" footprint="soic8" pcbX=\{0\} pcbY=\{0\}/, "U1 untouched")
  assert.match(settled, /<capacitor name="C1" capacitance="100nF" footprint="0603" pcbX=\{5\} pcbY=\{2\}/, "C1 untouched")
  assert.doesNotMatch(settled, /name="R1"[^>]*pcbX=\{0\} pcbY=\{0\}/, "R1 moved off U1")
  assert.match(settled, /<resistor name="R2" pcbX=\{-?[\d.]+\} pcbY=\{-?[\d.]+\}/, "R2 placed")
})

test("settlePlacement changes nothing when the repair moved no part", async () => {
  const cj = (await evaluateCircuitSource(normalizeCoderSource(BOARD))).circuitJson
  const pinned = BOARD.replace(`<capacitor name="C1"`, `<capacitor name="C1" pcbX={3} pcbY={-4}`)
  assert.equal(settlePlacement(pinned, cj, pinned), pinned)
})
