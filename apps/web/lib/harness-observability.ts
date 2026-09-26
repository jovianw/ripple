// Turns what the worker actually stores into something a person can read.
//
// The hard rule here: never claim more than the data supports. The worker does
// not record an agent, a tool call, a planner event, or a latency, so this file
// derives what it can from `stage`, marks it as derived, and leaves the rest
// visibly absent. A gap shown honestly is worth more than a convincing guess.

import type { HarnessDoc, LessonDoc, QueueItemDoc, RunDoc, SubcircuitDoc } from "./live";

export type Actor =
  | "planner"
  | "coder"
  | "critic"
  | "checker"
  | "assembler"
  | "meta"
  | "system"
  | "unknown";

export type ActorConfidence = "explicit" | "derived";

export type ObservationStatus =
  | "pending"
  | "running"
  | "success"
  | "failure"
  | "info";

export interface HarnessObservation {
  id: string;
  boardId: string;
  timestamp: string;
  source: "run" | "queue" | "harness";
  actor: Actor;
  actorConfidence: ActorConfidence;
  stage?: string;
  workItem?: {
    key: string;
    title: string;
    step?: number;
    status?: string;
    attempt?: number;
    maxAttempts?: number;
  };
  status: ObservationStatus;
  modelTier?: string;
  /**
   * True when the model/token/cost on this record describes the call that
   * *produced* the artefact rather than the actor named above. A `checks` run
   * is the case that matters: the checker is deterministic, and the usage
   * belongs to the coder call that generated the board being checked.
   */
  usageBelongsToProducer?: boolean;
  harnessVersion?: number;
  checker?: {
    passed: boolean;
    failures: { check: string; detail: string }[];
    drcErrors: number;
  };
  memory?: { lessonsUsed?: string[]; subcircuitsUsed?: string[] };
  usage?: { tokens?: number; costUsd?: number };
  summary: string;
}

/** The one place stage is turned into an actor. */
export const STAGE_ACTOR_MAP: Record<string, Actor> = {
  compile: "coder",
  subcircuit: "coder",
  critique: "critic",
  checks: "checker",
  final: "assembler",
  meta: "meta",
  error: "system",
  cache_hit: "system",
};

/** The design loop, as documented. `telemetry: false` means no run is ever
 *  written for that step, so it can never light up — shown honestly rather
 *  than drawn as idle. */
export type LoopStage = "spec" | "write" | "compile" | "check" | "critique" | "save";

export const DESIGN_LOOP: {
  id: LoopStage;
  label: string;
  sub: string;
  telemetry: boolean;
}[] = [
  { id: "spec", label: "Spec", sub: "English", telemetry: false },
  { id: "write", label: "Write", sub: "tscircuit (TSX)", telemetry: false },
  { id: "compile", label: "Compile", sub: "Circuit JSON", telemetry: true },
  { id: "check", label: "Check", sub: "hidden spec, DRC", telemetry: true },
  { id: "critique", label: "Critique", sub: "lessons", telemetry: true },
  { id: "save", label: "Save", sub: "subcircuit library", telemetry: true },
];

/** Run stage -> position in the design loop. */
export const LOOP_STAGE_MAP: Record<string, LoopStage> = {
  compile: "compile",
  checks: "check",
  final: "check",
  critique: "critique",
  subcircuit: "save",
};

/** Every node the harness has, whether or not it reports telemetry. */
export const TOPOLOGY: { actor: Actor; label: string }[] = [
  { actor: "planner", label: "Planner" },
  { actor: "coder", label: "Coder" },
  { actor: "checker", label: "Checker" },
  { actor: "critic", label: "Critic" },
  { actor: "assembler", label: "Assembler" },
  { actor: "meta", label: "Meta" },
];

/**
 * Actors that cannot currently appear in telemetry at all, because nothing
 * writes a run for them. Shown as "no telemetry", never as idle — idle would
 * imply we would know if they were working.
 */
export const UNINSTRUMENTED: ReadonlySet<Actor> = new Set<Actor>(["planner"]);

interface RunWithFuture extends RunDoc {
  /** Not written today. Preferred automatically if it ever appears. */
  agent?: string;
  lessons_used?: string[];
  subcircuits_used?: string[];
  failure_summary?: string;
}

export function deriveActorFromRun(run: RunWithFuture): {
  actor: Actor;
  confidence: ActorConfidence;
} {
  // Future-proofing: an explicit agent field wins the moment it exists.
  if (typeof run.agent === "string" && run.agent) {
    return { actor: run.agent as Actor, confidence: "explicit" };
  }
  return {
    actor: STAGE_ACTOR_MAP[run.stage] ?? "unknown",
    confidence: "derived",
  };
}

export function deriveRunStatus(run: RunDoc): ObservationStatus {
  if (run.stage === "error") return "failure";
  if (run.passed) return "success";
  // A compile record that did not pass is a failed attempt, not a neutral note.
  return "failure";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function summarizeRun(run: RunWithFuture, actor: Actor): string {
  if (run.failure_summary) return run.failure_summary;

  const failures = run.failures?.length ?? 0;
  switch (run.stage) {
    case "checks":
      return run.passed ? "All hidden checks passed" : `${plural(failures, "check")} failed`;
    case "compile":
      return run.passed ? "Compiled" : "Compile failed";
    case "subcircuit":
      return run.passed ? "Subcircuit verified" : `Subcircuit failed ${plural(failures, "check")}`;
    case "final":
      return run.passed ? "Board assembled and passed" : "Assembled board failed checks";
    case "critique":
      return "Critique pass";
    case "meta":
      return "Harness evaluation";
    case "cache_hit":
      return "Served from cache — already verified under this harness version";
    default:
      return `${actor} · ${run.stage}`;
  }
}

export function buildHarnessObservations(input: {
  runs: RunDoc[];
  queue: QueueItemDoc[];
}): HarnessObservation[] {
  const observations: HarnessObservation[] = [];

  for (const raw of input.runs) {
    const run = raw as RunWithFuture;
    const { actor, confidence } = deriveActorFromRun(run);
    const isChecks = run.stage === "checks" || run.stage === "final";

    observations.push({
      id: String(run._id),
      boardId: run.board_id,
      timestamp: run.ts,
      source: "run",
      actor,
      actorConfidence: confidence,
      stage: run.stage,
      status: deriveRunStatus(run),
      modelTier: run.model ?? undefined,
      // The checker is deterministic; usage on its record came from the coder.
      usageBelongsToProducer: isChecks && Boolean(run.model),
      harnessVersion: run.harness_version,
      checker: isChecks
        ? {
            passed: Boolean(run.passed),
            failures: run.failures ?? [],
            drcErrors: run.drc_errors ?? 0,
          }
        : undefined,
      memory:
        run.lessons_used?.length || run.subcircuits_used?.length
          ? { lessonsUsed: run.lessons_used, subcircuitsUsed: run.subcircuits_used }
          : undefined,
      usage:
        run.tokens !== undefined || run.cost_usd !== undefined
          ? { tokens: run.tokens, costUsd: run.cost_usd }
          : undefined,
      summary: summarizeRun(run, actor),
    });
  }

  for (const item of input.queue) {
    if (!item.status || item.status === "pending") continue;
    const ts = item.heartbeat ?? item._id;
    observations.push({
      id: `queue:${item._id}`,
      boardId: String((item as { board_id?: string }).board_id ?? ""),
      timestamp: typeof ts === "string" && ts.includes("T") ? ts : new Date(0).toISOString(),
      source: "queue",
      actor: "coder",
      actorConfidence: "derived",
      status:
        item.status === "done"
          ? "success"
          : item.status === "failed"
            ? "failure"
            : item.status === "running"
              ? "running"
              : "pending",
      workItem: {
        key: item.key ?? String(item._id),
        title: item.title ?? item.key ?? "work item",
        step: item.step,
        status: item.status,
        attempt: item.attempts,
      },
      summary: item.title ?? item.key ?? "work item",
    });
  }

  return observations.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Totals for one board's run records. */
export function boardTotals(runs: RunDoc[]): {
  tokens: number;
  costUsd: number;
  modelCalls: number;
  attempts: number;
  lastPassed: boolean | null;
} {
  let tokens = 0;
  let costUsd = 0;
  let modelCalls = 0;
  let attempts = 0;

  for (const r of runs) {
    tokens += r.tokens ?? 0;
    costUsd += r.cost_usd ?? 0;
    // A model tier is only recorded when a model was actually called.
    if (r.model) modelCalls += 1;
    if (r.stage === "checks" || r.stage === "final") attempts += 1;
  }

  const newest = [...runs].sort((a, b) => b.ts.localeCompare(a.ts))[0];
  return {
    tokens,
    costUsd,
    modelCalls,
    attempts,
    lastPassed: newest ? Boolean(newest.passed) : null,
  };
}

/** Resolve memory ids against the loaded lesson/subcircuit lists. */
export function resolveMemory(
  memory: HarnessObservation["memory"],
  lessons: LessonDoc[],
  subcircuits: SubcircuitDoc[],
): { lessons: LessonDoc[]; subcircuits: SubcircuitDoc[]; unresolved: number } {
  if (!memory) return { lessons: [], subcircuits: [], unresolved: 0 };
  const lessonById = new Map(lessons.map((l) => [l._id, l]));
  const subById = new Map(subcircuits.map((s) => [s._id, s]));

  const foundLessons = (memory.lessonsUsed ?? []).map((id) => lessonById.get(id));
  const foundSubs = (memory.subcircuitsUsed ?? []).map((id) => subById.get(id));

  return {
    lessons: foundLessons.filter((x): x is LessonDoc => Boolean(x)),
    subcircuits: foundSubs.filter((x): x is SubcircuitDoc => Boolean(x)),
    unresolved:
      foundLessons.filter((x) => !x).length + foundSubs.filter((x) => !x).length,
  };
}

/** Which actor, if any, is active right now. */
export function activeActors(
  observations: HarnessObservation[],
  withinMs = 15_000,
): Set<Actor> {
  const now = Date.now();
  const recent = new Set<Actor>();
  for (const o of observations) {
    const t = Date.parse(o.timestamp);
    if (Number.isFinite(t) && now - t <= withinMs) recent.add(o.actor);
    if (o.status === "running") recent.add(o.actor);
  }
  return recent;
}

export function versionDiff(
  parent: HarnessDoc | undefined,
  child: HarnessDoc,
): { field: string; from: string; to: string }[] {
  if (!parent) return [];
  const out: { field: string; from: string; to: string }[] = [];
  for (const group of ["context", "workflow", "routing", "tools"] as const) {
    const a = (parent[group] ?? {}) as Record<string, unknown>;
    const b = (child[group] ?? {}) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const from = JSON.stringify(a[key]);
      const to = JSON.stringify(b[key]);
      if (from !== to) out.push({ field: `${group}.${key}`, from: from ?? "—", to: to ?? "—" });
    }
  }
  const pr = new Set(parent.rules ?? []);
  const cr = new Set(child.rules ?? []);
  for (const r of cr) if (!pr.has(r)) out.push({ field: "rule added", from: "—", to: r });
  for (const r of pr) if (!cr.has(r)) out.push({ field: "rule removed", from: r, to: "—" });
  return out;
}
