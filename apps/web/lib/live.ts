// Shapes returned by the Atlas-backed routes. Deliberately loose about fields
// the worker may add later — the UI reads what it needs and ignores the rest.

export interface RunDoc {
  _id: string;
  board_id: string;
  harness_version: number;
  stage: string;
  passed: boolean;
  failures?: { check: string; detail: string }[];
  drc_errors?: number;
  metrics?: { area_mm2?: number; vias?: number; trace_mm?: number; bom_usd?: number };
  model?: string;
  tokens?: number;
  cost_usd?: number;
  ts: string;
}

export interface HarnessDoc {
  version: number;
  parent: number | null;
  rules?: string[];
  verdict?: "kept" | "pending" | "rolled_back" | "rejected";
  rationale?: string;
  gate_note?: string;
  decided_at?: string;
  scores?: {
    checks_passed?: number;
    attempts_per_board?: number;
    cost_per_board_usd?: number;
  };
  context?: Record<string, unknown>;
  workflow?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  tools?: Record<string, unknown>;
}

export interface LessonDoc {
  _id: string;
  pattern: string;
  fix: string;
  times_helped?: number;
  created_at?: string;
}

export interface SubcircuitDoc {
  _id: string;
  name: string;
  description?: string;
  checks_passed?: string[];
  reuse_count?: number;
}

export interface QueueItemDoc {
  _id: string;
  key?: string;
  title?: string;
  step?: number;
  status?: string;
  attempts?: number;
  heartbeat?: string;
  stale?: boolean;
}

export interface Health {
  connected: boolean;
  configured: boolean;
  latency_ms?: number;
  database?: string;
  counts?: Record<string, number>;
  error?: string;
}

/** Relative time, in the terse form an operator wants. */
export function ago(iso: string | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** Diff two configs field by field, for the evolution view. */
export function diffConfigs(
  parent: HarnessDoc | undefined,
  child: HarnessDoc,
): { field: string; from: string; to: string }[] {
  if (!parent) return [];
  const out: { field: string; from: string; to: string }[] = [];
  const groups = ["context", "workflow", "routing", "tools"] as const;

  for (const group of groups) {
    const a = (parent[group] ?? {}) as Record<string, unknown>;
    const b = (child[group] ?? {}) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const from = JSON.stringify(a[key]);
      const to = JSON.stringify(b[key]);
      if (from !== to) out.push({ field: `${group}.${key}`, from: from ?? "—", to: to ?? "—" });
    }
  }

  const parentRules = new Set(parent.rules ?? []);
  const childRules = new Set(child.rules ?? []);
  for (const r of childRules) if (!parentRules.has(r)) out.push({ field: "rules", from: "—", to: `+ ${r}` });
  for (const r of parentRules) if (!childRules.has(r)) out.push({ field: "rules", from: `− ${r}`, to: "—" });

  return out;
}
