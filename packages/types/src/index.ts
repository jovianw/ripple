// Shared contracts. HarnessConfig and RunResult are frozen at kickoff (DESIGN.md §4);
// change them only with the whole team's agreement.

export type ModelTier = "cheap" | "strong";
export type AgentName = "planner" | "coder" | "critic" | "meta";
export type Verdict = "kept" | "rolled_back" | "rejected" | "pending";

export interface HarnessConfig {
  version: number;
  parent: number | null;
  rules: string[];
  context: {
    subcircuits_k: number;
    lessons_k: number;
    rerank: boolean;
    include_last_failure: boolean;
  };
  tools: {
    route_requires_connectivity: boolean;
    parts_whitelist: string;
    mcp: Record<AgentName, string[]>;
  };
  workflow: {
    plan_first: boolean;
    repair_budget: number;
    split_over_parts: number;
  };
  routing: Record<AgentName, ModelTier>;
  scores?: {
    checks_passed: number;
    attempts_per_board: number;
    cost_per_board_usd: number;
    /** Added after kickoff (optional, additive): mean partial credit, share of applied hidden-check categories passed. */
    check_score?: number;
    /** Added after kickoff (optional, additive): means over passing boards, null when none passed. Display only. */
    board?: BoardQualityMeans | null;
  };
  verdict: Verdict;
  rationale: string;
}

export interface BoardQualityMeans {
  area_mm2: number;
  density: number;
  detour: number;
  vias: number;
  parts: number;
  bom_usd: number;
}

export interface CheckFailure {
  check: string;
  detail: string;
}

export interface BoardMetrics {
  area_mm2: number;
  vias: number;
  trace_mm: number;
  bom_usd: number;
}

export interface RunResult {
  board_id: string;
  harness_version: number;
  stage: string;
  passed: boolean;
  failures: CheckFailure[];
  drc_errors: number;
  metrics?: BoardMetrics;
  model?: ModelTier;
  tokens?: number;
  cost_usd?: number;
  ts: string; // ISO 8601
}

// Draft shapes below come from the data model table and can still change at kickoff.

export interface Spec {
  _id: string;
  text: string;
  split: "train" | "held_out"; // never contains check contents
}

export interface Board {
  _id: string;
  spec_id: string;
  harness_version: number;
  code: string; // tscircuit source
  circuit_json?: unknown;
  metrics?: BoardMetrics;
  subcircuits_used: string[];
}

export interface Subcircuit {
  _id: string;
  name: string;
  code: string;
  embedding: number[];
  checks_passed: string[];
  reuse_count: number;
}

export interface Lesson {
  _id: string;
  pattern: string;
  fix: string;
  embedding: number[];
  times_helped: number;
}

export type WorkItemStatus = "pending" | "running" | "done" | "failed";

export interface WorkItem {
  _id: string;
  board_id: string;
  status: WorkItemStatus;
  depends_on: string[];
  heartbeat?: string; // ISO 8601
}
