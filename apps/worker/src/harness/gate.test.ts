// Gate concurrency: two callers racing evaluatePending must never score/record the same version twice,
// and a candidate proposed from a parent that's since been superseded must not silently outrank the sibling
// that replaced it. Run: npm run test:gate (never connects: gate.ts imports db.ts, which only needs MONGODB_URI set)
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
const store = (harness: GateStore["harness"], runs: GateStore["runs"] = {} as GateStore["runs"]): GateStore => ({ harness, runs })

/** In-memory `runs` that answers scoreVersion's aggregate the way Mongo would. */
function fakeRuns(rows: Pick<StoredRun, "board_id" | "harness_version" | "stage" | "passed" | "cost_usd">[]): GateStore["runs"] {
  return {
    aggregate(pipeline: { $match?: { harness_version: number; board_id?: { $in: string[] } } }[]) {
      const m = pipeline[0].$match!
      const rs = rows.filter((r) => r.harness_version === m.harness_version && (!m.board_id || m.board_id.$in.includes(r.board_id)))
      const boards = new Map<string, typeof rs>()
      for (const r of rs) boards.set(r.board_id, [...(boards.get(r.board_id) ?? []), r])
      const per = [...boards.values()].map((list) => ({
        passed: list.some((r) => r.passed) ? 1 : 0,
        attempts: list.filter((r) => r.stage === "checks").length,
        cost: list.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
      }))
      const avg = (k: "passed" | "attempts" | "cost") => per.reduce((s, b) => s + b[k], 0) / per.length
      const out = per.length ? [{ boards: per.length, checks_passed: avg("passed"), attempts_per_board: avg("attempts"), cost_per_board_usd: avg("cost") }] : []
      return { toArray: async () => out }
    },
  } as unknown as GateStore["runs"]
}

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

  test("a candidate whose parent was superseded is rejected as stale without spending a batch", async () => {
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
    assert.equal(decision.verdict, "rejected")
    assert.match(decision.reasons.join(" "), /stale/)
    const final = (await harness.findOne({ version: 2 })) as StoredConfig
    assert.equal(final.verdict, "rejected")
    assert.equal(final.claimed_by, undefined)
  })

  test("two sibling proposals scored in parallel can't both be kept", async () => {
    const harness = fakeHarness([
      cfg({ version: 0, parent: null, verdict: "kept", scores: { checks_passed: 0.5, attempts_per_board: 3, cost_per_board_usd: 0.01 } }),
      cfg({ version: 1, parent: 0, verdict: "pending" }),
      cfg({ version: 2, parent: 0, verdict: "pending" }),
    ])
    // Every batch scores better than v0, and takes long enough that both callers are past the claim-time check.
    const better = { checks_passed: 0.9, attempts_per_board: 1, cost_per_board_usd: 0.001, boards: 8 }
    const runs = { aggregate: () => ({ toArray: async () => [better] }) } as unknown as GateStore["runs"]
    const s: GateStore = { harness, runs }
    const slowBatch: RunBatch = async () => {
      await new Promise((r) => setTimeout(r, 10))
      return { boardIds: ["b"] }
    }

    const decisions = await Promise.all([
      evaluatePending(slowBatch, { store: s, workerId: "worker-a" }),
      evaluatePending(slowBatch, { store: s, workerId: "worker-b" }),
    ])

    assert.deepEqual(decisions.map((d) => d?.verdict).sort(), ["kept", "rejected"])
    const kept = decisions.find((d) => d?.verdict === "kept")!
    const lost = decisions.find((d) => d?.verdict === "rejected")!
    assert.match(lost.reasons.join(" "), new RegExp(`stale: .* v${kept.version} is current`))
    assert.equal((await harness.findOne({ version: 0 }))?.succeeded_by, kept.version)
    assert.equal((await harness.findOne({ verdict: "kept" }, { sort: { version: -1 } }))?.version, kept.version)
  })
})

describe("evaluatePending parent scoring", () => {
  const run = (board_id: string, harness_version: number, passed: boolean, cost_usd = 0.01) => ({ board_id, harness_version, stage: "checks", passed, cost_usd })
  const seed = () => [
    cfg({ version: 0, parent: null, verdict: "kept", scores: { checks_passed: 0, attempts_per_board: 2.5, cost_per_board_usd: 0.002 } }),
    cfg({ version: 1, parent: 0, verdict: "pending", rules: ["new rule"] }),
  ]
  // Tonight's parent batch: 2/2 passed. The candidate: 1/2. The stored v0 scores (0%) are from an older round.
  const runs = fakeRuns([run("p1", 0, true), run("p2", 0, true), run("c1", 1, true), run("c2", 1, false)])
  const batch: RunBatch = async () => ({ boardIds: ["c1", "c2"] })

  test("with parentBoardIds the parent is scored from that batch, not its stale stored scores", async () => {
    const harness = fakeHarness(seed())
    const decision = await evaluatePending(batch, { store: store(harness, runs), parentBoardIds: ["p1", "p2"] })
    assert.equal(decision?.verdict, "rolled_back")
    assert.match(decision!.reasons[0], /v1 pass 50%.*vs v0 pass 100%/)
    assert.equal((await harness.findOne({ version: 0 }))!.scores!.checks_passed, 1)
  })

  test("without parentBoardIds the stored parent scores are used", async () => {
    const decision = await evaluatePending(batch, { store: store(fakeHarness(seed()), runs) })
    assert.equal(decision?.verdict, "kept")
    assert.match(decision!.reasons[0], /vs v0 pass 0%/)
  })
})
