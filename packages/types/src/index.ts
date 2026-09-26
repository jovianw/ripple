// Frozen contracts (DESIGN.md §4). Everything builds against these two shapes;
// change them only with the whole team's agreement.

export type AgentRole = "planner" | "coder" | "critic" | "meta";
export type ModelTier = "cheap" | "strong";

export type Verdict = "baseline" | "testing" | "kept" | "rolled_back" | "rejected";

export interface HarnessScores {
  checks_passed: number; // fraction of hidden checks passed, 0..1
  attempts_per_board: number;
  cost_per_board_usd: number;
}

/** One document per version in `harness_versions`. Never updated in place except for scores/verdict. */
export interface HarnessConfig {
  version: number;
  parent: number | null; // null only for the baseline
  rules: string[];
  context: {
    subcircuits_k: number;
    lessons_k: number;
    rerank: boolean;
    include_last_failure: boolean;
  };
  tools: {
    route_requires_connectivity: boolean;
    parts_whitelist: string; // whitelist version id
    mcp: Record<AgentRole, string[]>; // read-only MCP tools each agent may call, e.g. ["find", "aggregate"]
  };
  workflow: {
    plan_first: boolean;
    repair_budget: number;
    split_over_parts: number;
  };
  routing: Record<AgentRole, ModelTier>;
  scores?: HarnessScores; // set by the config gate after a test batch
  verdict: Verdict;
  rationale: string;
}

export type RunStage =
  | "plan"
  | "write"
  | "compile"
  | "route"
  | "drc"
  | "checks"
  | "critique"
  | "meta"
  | "mcp"
  | "final";

export interface RunFailure {
  check: string;
  detail: string;
}

export interface BoardMetrics {
  area_mm2: number;
  vias: number;
  trace_mm: number;
  bom_usd: number;
}

/** One document per model call or tool result in `runs`. Every tool returns this shape. */
export interface RunResult {
  _id?: string; // sha1(board_id:step:attempt), written with upsert so replays overwrite
  board_id: string;
  harness_version: number;
  stage: RunStage;
  attempt: number;
  passed: boolean;
  failures: RunFailure[];
  drc_errors?: number;
  metrics?: BoardMetrics;
  agent?: AgentRole;
  model?: ModelTier;
  model_id?: string; // concrete OpenRouter model the tier resolved to
  tokens?: number;
  cost_usd?: number;
  ts: Date;
}
