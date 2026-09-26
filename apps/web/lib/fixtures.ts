// Fixture data for the UI. Typed with the frozen contracts so the switch to live
// Atlas data is a change of source, not a rewrite (AGENTS.md: contracts are frozen).
//
// The sequence below mirrors the first 40 seconds of the demo in DESIGN.md §8:
// a spec goes in, the first attempt fails a hidden check, the critic writes a
// lesson, the fix lands, the second attempt passes.

import type {
  AgentName,
  HarnessConfig,
  Lesson,
  RunResult,
  Spec,
} from "@ripple/types";

export const EXAMPLE_SPECS: string[] = [
  "Read a temperature sensor over I2C, powered from USB-C, with a status LED.",
  "Battery-powered soil moisture logger: ESP32, LiPo charger, micro-SD.",
  "USB-C to UART bridge with ESD protection and a power LED.",
  "3.3V buck regulator from 12V input, 1A, with output filtering.",
];

export const CURRENT_SPEC: Spec = {
  _id: "s_004",
  text: EXAMPLE_SPECS[0],
  split: "train",
};

export const CURRENT_CONFIG: HarnessConfig = {
  version: 4,
  parent: 3,
  rules: [
    "I2C lines need pull-up resistors",
    "Every IC power pin needs a decoupling cap within 3mm",
  ],
  context: {
    subcircuits_k: 2,
    lessons_k: 5,
    rerank: true,
    include_last_failure: true,
  },
  tools: {
    route_requires_connectivity: true,
    parts_whitelist: "v2",
    mcp: { critic: ["find", "aggregate"], meta: ["find", "aggregate"], coder: [], planner: [] },
  },
  workflow: { plan_first: true, repair_budget: 3, split_over_parts: 12 },
  routing: { planner: "strong", coder: "cheap", critic: "strong", meta: "strong" },
  scores: { checks_passed: 0.82, attempts_per_board: 2.4, cost_per_board_usd: 0.31 },
  verdict: "kept",
  rationale: "Missing pull-ups caused 4 of 9 failures in batch 3",
};

const DECOUPLING_LESSON: Lesson = {
  _id: "l_012",
  pattern: "IC power pin with no decoupling cap within 3mm",
  fix: "Place a 100nF X7R from each VDD pin to GND, routed to the pin before the plane",
  embedding: [],
  times_helped: 3,
};

export type FeedEventKind = "stage" | "pass" | "fail" | "lesson" | "fix";

export interface FeedEvent {
  id: string;
  /** Offset from the start of the run, in ms. Drives the replay timing. */
  at_ms: number;
  kind: FeedEventKind;
  agent?: AgentName;
  title: string;
  detail?: string;
  /** Present on pass/fail events — the real contract object the worker would emit. */
  run?: RunResult;
  lesson?: Lesson;
}

const ts = (offsetSec: number): string =>
  new Date(Date.UTC(2026, 8, 26, 13, 12, 5 + offsetSec)).toISOString();

const baseRun = {
  board_id: "b_017",
  harness_version: 4,
  drc_errors: 0,
} as const;

export const FEED_EVENTS: FeedEvent[] = [
  {
    id: "e01",
    at_ms: 0,
    kind: "stage",
    agent: "planner",
    title: "Planned 3 subcircuits",
    detail: "USB-C power in → 3.3V rail → I2C sensor + status LED",
  },
  {
    id: "e02",
    at_ms: 900,
    kind: "stage",
    agent: "coder",
    title: "Retrieved 2 subcircuits, 5 lessons",
    detail: "Reused usb_c_power_in (14 prior uses) and i2c_pullups (9 prior uses)",
  },
  {
    id: "e03",
    at_ms: 1800,
    kind: "stage",
    agent: "coder",
    title: "Wrote tscircuit code",
    detail: "11 parts, 2 layers",
  },
  {
    id: "e04",
    at_ms: 2600,
    kind: "stage",
    title: "Compiled to Circuit JSON",
    detail: "Autoroute complete · DRC 0 errors",
  },
  {
    id: "e05",
    at_ms: 3600,
    kind: "fail",
    title: "Hidden checks failed",
    detail: "1 of 4 checks failed on attempt 1",
    run: {
      ...baseRun,
      stage: "checks",
      passed: false,
      failures: [{ check: "decoupling", detail: "U2 VDD has no cap within 3mm" }],
      metrics: { area_mm2: 812, vias: 6, trace_mm: 214, bom_usd: 4.12 },
      model: "cheap",
      tokens: 5120,
      cost_usd: 0.004,
      ts: ts(0),
    },
  },
  {
    id: "e06",
    at_ms: 4900,
    kind: "lesson",
    agent: "critic",
    title: "Lesson written to memory",
    detail: DECOUPLING_LESSON.fix,
    lesson: DECOUPLING_LESSON,
  },
  {
    id: "e07",
    at_ms: 6000,
    kind: "fix",
    agent: "coder",
    title: "Applied smallest fix",
    detail: "Added C7 100nF between U2 VDD and GND · attempt 2 of 3",
  },
  {
    id: "e08",
    at_ms: 7200,
    kind: "pass",
    title: "Hidden checks passed",
    detail: "4 of 4 checks passed · board saved to library",
    run: {
      ...baseRun,
      stage: "checks",
      passed: true,
      failures: [],
      metrics: { area_mm2: 826, vias: 6, trace_mm: 221, bom_usd: 4.14 },
      model: "cheap",
      tokens: 3480,
      cost_usd: 0.003,
      ts: ts(38),
    },
  },
];

/** Totals for the stat row, derived from the feed so they can never drift from it. */
export function summarize(events: FeedEvent[]) {
  const runs = events.flatMap((e) => (e.run ? [e.run] : []));
  const last = runs.at(-1);
  const totalChecks = 4;
  return {
    checksPassed: last ? totalChecks - last.failures.length : 0,
    totalChecks,
    attempts: runs.length,
    repairBudget: CURRENT_CONFIG.workflow.repair_budget,
    costUsd: runs.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0),
    harnessVersion: CURRENT_CONFIG.version,
    passed: last?.passed ?? false,
    settled: Boolean(last?.passed),
  };
}

export const RUN_DURATION_MS = FEED_EVENTS.at(-1)!.at_ms + 800;
