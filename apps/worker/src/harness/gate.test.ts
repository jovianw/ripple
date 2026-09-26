// Gate concurrency: two callers racing evaluatePending must never score/record the same version twice,
// and a candidate proposed from a parent that's since been superseded must not silently outrank the sibling
// that replaced it. Run: npm run test:gate (never connects: gate.ts imports db.ts, which only needs MONGODB_URI set)
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import type { HarnessConfig } from "@ripple/types"
import type { StoredConfig, StoredRun } from "../db.ts"
import { BASELINE } from "./config.ts"
import { evaluatePending, isBetter, scoreVersion, specQuality, type GateStore, type RunBatch } from "./gate.ts"
import { boardRatio, median, qualityVsParent, type BoardQuality, type RunQuality } from "./quality.ts"

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

const QUALITY: RunQuality = { area_mm2: 200, density: 0.2, detour: 1.1, vias: 2, parts: 5, bom_usd: 0.4, trace_mm: 40, connections: 8 }
/** One board as gate.ts's per-board aggregation returns it. */
const row = (id: string, spec: string, passed: boolean, over: Partial<{ check_score: number | null; quality: RunQuality }> = {}) => ({
  _id: id,
  spec_id: spec,
  passed: passed ? 1 : 0,
  attempts: 1,
  cost: 0.001,
  check_score: over.check_score === undefined ? (passed ? 1 : 0.5) : over.check_score,
  finals: passed ? [over.quality ?? QUALITY] : [],
})
/** Stand-in for `runs`: answers the gate's aggregation with the rows for the board ids it matches on. */
function fakeRuns(rows: Record<string, ReturnType<typeof row>>): GateStore["runs"] {
  return {
    aggregate: (pipeline: { $match?: { board_id?: { $in: string[] } } }[]) => ({
      toArray: async () => (pipeline[0].$match?.board_id?.$in ?? Object.keys(rows)).map((id) => rows[id]).filter(Boolean),
    }),
  } as unknown as GateStore["runs"]
}
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
    // Every candidate batch passes where v0's failed, and takes long enough that both callers are past the claim-time check.
    const s: GateStore = {
      harness,
      runs: fakeRuns({ p: row("p", "t01", false), b1: row("b1", "t01", true), b2: row("b2", "t01", true) }),
    }
    const slowBatch: RunBatch = async (config) => {
      await new Promise((r) => setTimeout(r, 10))
      return { boardIds: [config.version === 0 ? "p" : `b${config.version}`] }
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

describe("isBetter: correctness first, then board quality, then effort", () => {
  const base = { checks_passed: 0.5, check_score: 0.8, attempts_per_board: 2, cost_per_board_usd: 0.01 }
  const tie = { ratio: 1, shared: 4 }

  test("more boards passing wins even with worse partial credit and worse boards", () => {
    assert.equal(isBetter({ ...base, checks_passed: 0.75, check_score: 0.5 }, base, { ratio: 0.5, shared: 4 }), true)
  })
  test("partial credit beyond the tie band decides a pass-rate tie", () => {
    assert.equal(isBetter({ ...base, check_score: 0.85 }, base, { ratio: 0.5, shared: 4 }), true)
    assert.equal(isBetter({ ...base, check_score: 0.75 }, base, { ratio: 2, shared: 4 }), false)
  })
  test("partial credit within the band falls through to board quality", () => {
    assert.equal(isBetter({ ...base, check_score: 0.81 }, base, { ratio: 1.1, shared: 4 }), true)
    assert.equal(isBetter({ ...base, check_score: 0.81 }, base, { ratio: 0.9, shared: 4 }), false)
  })
  test("board quality within ±3% or with no shared spec falls through to attempts, then cost", () => {
    assert.equal(isBetter({ ...base, attempts_per_board: 1.5 }, base, { ratio: 0.98, shared: 4 }), true)
    assert.equal(isBetter({ ...base, attempts_per_board: 2.5 }, base, { ratio: null, shared: 0 }), false)
    assert.equal(isBetter({ ...base, cost_per_board_usd: 0.005 }, base, tie), true)
    assert.equal(isBetter(base, base, tie), false)
  })
})

describe("board quality", () => {
  const q: BoardQuality = { area_mm2: 200, detour: 1.2, vias: 3, parts: 5, bom_usd: 0.4 }

  test("boardRatio: identical boards are 1; half the area on one of five measures is 2^(1/5)", () => {
    assert.equal(boardRatio(q, q), 1)
    assert.ok(Math.abs(boardRatio(q, { ...q, area_mm2: 100 }) - 2 ** (1 / 5)) < 1e-12)
    assert.ok(boardRatio(q, { ...q, vias: 0 }) > 1, "via-free compares through vias + 1")
    assert.throws(() => boardRatio(q, { ...q, bom_usd: 0 }), /bom_usd/)
  })

  test("qualityVsParent: median over shared specs, null when none are shared", () => {
    const parent = new Map([["a", q], ["b", q], ["c", q]])
    const cand = new Map([["a", { ...q, area_mm2: 100 }], ["b", q], ["c", { ...q, area_mm2: 400 }], ["d", q]])
    assert.deepEqual(qualityVsParent(cand, parent), { ratio: 1, shared: 3 })
    assert.deepEqual(qualityVsParent(new Map([["x", q]]), parent), { ratio: null, shared: 0 })
    assert.equal(median([3, 1, 2, 4]), 2.5)
  })
})

describe("scoreVersion / specQuality", () => {
  test("partial credit is averaged over every board, board quality over the passing ones", async () => {
    const store = { harness: {} as GateStore["harness"], runs: fakeRuns({
      a: row("a", "t01", true, { quality: { ...QUALITY, area_mm2: 100 } }),
      b: row("b", "t02", true, { quality: { ...QUALITY, area_mm2: 300 } }),
      c: row("c", "t03", false, { check_score: 0.25 }),
    }) }
    const s = await scoreVersion(1, { boardIds: ["a", "b", "c"], store })
    assert.ok(s)
    assert.equal(s.boards, 3)
    assert.ok(Math.abs(s.checks_passed - 2 / 3) < 1e-12)
    assert.ok(Math.abs(s.check_score - 0.75) < 1e-12)
    assert.equal(s.board?.area_mm2, 200)
    assert.deepEqual([...(await specQuality(1, { boardIds: ["a", "b", "c"], store })).keys()], ["t01", "t02"])
  })

  test("refuses boards recorded before graded scoring instead of guessing", async () => {
    const store = { harness: {} as GateStore["harness"], runs: fakeRuns({ old: row("old", "t01", true, { check_score: null }) }) }
    await assert.rejects(scoreVersion(0, { boardIds: ["old"], store }), /before graded scoring/)
  })

  test("specQuality refuses a batch that built the same spec twice", async () => {
    const store = { harness: {} as GateStore["harness"], runs: fakeRuns({ a: row("a", "t01", true), b: row("b", "t01", true) }) }
    await assert.rejects(specQuality(0, { boardIds: ["a", "b"], store }), /more than one board/)
  })
})
