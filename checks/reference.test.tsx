// Every spec is solvable: each reference board passes its own spec's hidden checks with 0 DRC errors.
// Run: npm run test:checks
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { runChecks, loadExpected } from "./index.ts"
import { renderBoard } from "./fixtures/render.tsx"
import { referenceBoards } from "./reference/index.ts"

describe("reference boards", () => {
  for (const [specId, Board] of Object.entries(referenceBoards)) {
    test(`${specId} passes its hidden checks`, async () => {
      const r = await runChecks(await renderBoard(Board), loadExpected(specId))
      assert.equal(r.passed, true, r.failures.map((f) => `${f.check}: ${f.detail}`).join("\n"))
      assert.equal(r.drc_errors, 0)
    })
  }
})
