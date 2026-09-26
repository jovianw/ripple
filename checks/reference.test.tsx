// Every spec in specs/specs.json has a reference board that passes its expected checks with 0 DRC
// errors, which proves each spec is solvable with whitelisted parts. Run: npm run test:checks
import { test, describe, before } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import type { AnyCircuitElement } from "circuit-json"
import { runChecks, loadExpected } from "./index.ts"
import { renderBoard } from "./fixtures/render.tsx"
import { referenceBoards } from "./reference/index.ts"
import { H04Reference } from "./reference/h04_dual_led_driver.tsx"

const specs = JSON.parse(readFileSync("specs/specs.json", "utf8")) as { _id: string; split: string }[]
const rendered = new Map<string, AnyCircuitElement[]>()

describe("reference boards pass their spec's checks", () => {
  before(async () => {
    for (const s of specs) {
      assert.ok(referenceBoards[s._id], `no reference board for ${s._id}`)
      rendered.set(s._id, await renderBoard(referenceBoards[s._id]))
    }
  })
  for (const s of specs) {
    test(`${s._id} (${s.split})`, async () => {
      const r = await runChecks(rendered.get(s._id)!, loadExpected(s._id), { board_id: s._id })
      assert.deepEqual(r.failures, [])
      assert.equal(r.passed, true)
      assert.equal(r.drc_errors, 0)
    })
  }

  test("h04 with LED_A and LED_B behind one shared resistor fails", async () => {
    const r = await runChecks(await renderBoard(() => <H04Reference sharedResistor />), loadExpected("h04_dual_led_driver"))
    assert.equal(r.passed, false)
    assert.ok(r.failures.some((f) => /LED/.test(f.detail)), JSON.stringify(r.failures))
  })
})
