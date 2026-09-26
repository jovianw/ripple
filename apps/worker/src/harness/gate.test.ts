// Gate concurrency: two callers racing evaluatePending must never score/record the same version twice,
// and a candidate proposed from a parent that's since been superseded must not silently outrank the sibling
// that replaced it. Run: npm run test:gate
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import type { HarnessConfig } from "@ripple/types"
import type { StoredConfig, StoredRun } from "../db.ts"
import { BASELINE } from "./config.ts"
import { evaluatePending, type GateStore, type RunBatch } from "./gate.ts"

type Filter = Record<string, unknown>

function matches(doc: StoredConfig, filter: Filter): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Filter[]).some((f) => matches(doc, f))
    const value = (doc as unknown as Record<string, unknown>)[key]
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      const ops = cond as Record<string, unknown>
      if ("$exists" in ops) return ops.$exists ? value !== undefined : value === undefined
      if ("$lt" in ops) return value !== undefined && (value as string) < (ops.$lt as string)
    }
    return value === cond
  })
}

function applyUpdate(doc: StoredConfig, update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }) {
  Object.assign(doc, update.$set ?? {})
  for (const k of Object.keys(update.$unset ?? {})) delete (doc as unknown as Record<string, unknown>)[k]
}

/** In-memory stand-in for the `harness_versions` collection, atomic the same way Mongo's findOneAndUpdate is:
 *  the match-and-mutate happens in one synchronous step, so two "concurrent" callers never both see a claimable doc. */
function fakeHarness(seed: StoredConfig[]): GateStore["harness"] {
  const docs = seed.map((d) => ({ ...d }))
  return {
    async findOne(filter: Filter, opts: { sort?: Record<string, 1 | -1> } = {}) {
      const found = docs.filter((d) => matches(d, filter))
      if (opts.sort) {
        const [[key, dir]] = Object.entries(opts.sort)
        found.sort((a, b) => (((a as never)[key] - (b as never)[key]) as number) * dir)
      }
      return found[0] ? { ...found[0] } : null
    },
    async findOneAndUpdate(filter: Filter, update: never, opts: { sort?: Record<string, 1 | -1> } = {}) {
      const found = docs.filter((d) => matches(d, filter))
      if (opts.sort) {
        const [[key, dir]] = Object.entries(opts.sort)
        found.sort((a, b) => (((a as never)[key] - (b as never)[key]) as number) * dir)
      }
      const doc = found[0]
      if (!doc) return null
      applyUpdate(doc, update)
      return { ...doc }
    },
    async updateOne(filter: Filter, update: never) {
      const doc = docs.find((d) => matches(d, filter))
      if (!doc) return { matchedCount: 0 }
      applyUpdate(doc, update)
      return { matchedCount: 1 }
    },
  } as unknown as GateStore["harness"]
}

const cfg = (over: Partial<StoredConfig>): StoredConfig => ({ ...BASELINE, ...over }) as StoredConfig
const noBatch: RunBatch = () => {
  throw new Error("runBatch should not have been called")
}
const store = (harness: GateStore["harness"]): GateStore => ({ harness, runs: {} as GateStore["runs"] })

describe("evaluatePending concurrency", () => {
  test("two concurrent callers never both claim and decide the same pending version", async () => {
    const harness = fakeHarness([
      cfg({ version: 0, parent: null, verdict: "kept" }),
      // A guardrail violation (wrong whitelist) resolves without a batch, so this exercises the claim/record path only.
      cfg({ version: 1, parent: 0, verdict: "pending", tools: { ...BASELINE.tools, parts_whitelist: "v2" } }),
    ])
    const s = store(harness)

    const [a, b] = await Promise.all([
      evaluatePending(noBatch, { store: s, workerId: "worker-a" }),
      evaluatePending(noBatch, { store: s, workerId: "worker-b" }),
    ])

    const decisions = [a, b].filter((d): d is NonNullable<typeof d> => d !== null)
    assert.equal(decisions.length, 1, "exactly one caller should have found the version claimable")
    assert.equal(decisions[0].verdict, "rejected")

    const final = await harness.findOne({ version: 1 })
    assert.equal(final?.verdict, "rejected")
    assert.equal((final as StoredConfig).claimed_by, undefined, "claim is released once a verdict is recorded")
  })

  test("a candidate whose parent was superseded is rolled back without spending a batch", async () => {
    const harness = fakeHarness([
      cfg({ version: 0, parent: null, verdict: "kept" }),
      // v1 already decided "kept" off v0 (as if a first evolve run finished first) — it's current now.
      cfg({ version: 1, parent: 0, verdict: "kept" }),
      // v2 was proposed off v0 too (a second, concurrent evolve run), before v1 was decided.
      cfg({ version: 2, parent: 0, verdict: "pending" }),
    ])
    const s = store(harness)

    const decision = await evaluatePending(noBatch, { store: s, workerId: "worker-a" })

    assert.ok(decision)
    assert.equal(decision.verdict, "rolled_back")
    assert.match(decision.reasons.join(" "), /stale/)
    const final = (await harness.findOne({ version: 2 })) as StoredConfig
    assert.equal(final.verdict, "rolled_back")
    assert.equal(final.claimed_by, undefined)
  })
})
