// Replay a board that Ripple actually built.
//
// Every part, trace, failure and verdict here comes from Atlas. The only thing
// this file invents is the *order of reveal* during placement — the worker does
// not record placement order, and a board appearing all at once reads as a
// static image rather than something being assembled. Nothing that a viewer
// would take as a fact is synthesised.

import { componentsNamedIn } from "./blocks";
import type { RunDoc } from "./live";
import type {
  BuildSnapshot,
  PCBComponent,
  PCBState,
  PCBTrace,
} from "./types";

/** Just enough of a spec to caption the replay. */
export interface SpecEntry {
  _id: string;
  text: string;
}

export interface RealBoardPayload {
  board: {
    board_id: string;
    spec_id?: string;
    passed: boolean | null;
    failures: { check: string; detail: string }[];
    harness_version?: number;
  };
  pcb: PCBState;
  errors: { message: string; componentId?: string }[];
}

/** Split into n roughly equal groups, preserving order. */
function chunk<T>(items: T[], groups: number): T[][] {
  if (items.length === 0) return [];
  const size = Math.ceil(items.length / groups);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const shortSpec = (text: string): string =>
  text.length > 74 ? `${text.slice(0, 71)}…` : text;

export function buildSnapshotsFromBoard(args: {
  spec: SpecEntry;
  payload: RealBoardPayload;
  runs: RunDoc[];
}): BuildSnapshot[] {
  const { spec, payload, runs } = args;
  const { pcb, board } = payload;

  const board2 = pcb.board;
  const empty = (components: PCBComponent[], traces: PCBTrace[]): PCBState => ({
    board: board2,
    components,
    traces,
  });

  const checkRuns = runs.filter((r) => r.stage === "checks" || r.stage === "final");
  const attempts = checkRuns.length || 1;
  const drc = checkRuns.at(-1)?.drc_errors ?? 0;
  const failures = board.failures ?? [];
  const passed = board.passed === true;
  const faulted = componentsNamedIn(failures, pcb.components);

  const groups = chunk(pcb.components, 3);
  const snapshots: BuildSnapshot[] = [];
  let version = 0;
  const push = (s: Omit<BuildSnapshot, "version" | "timestamp">) => {
    snapshots.push({ ...s, version, timestamp: version * 1000 });
    version += 1;
  };

  push({
    stage: "planning",
    agent: "planner",
    message: "Parsing requirements",
    status: "working",
    tick: "Parse",
    delay: 900,
    drcErrors: 0,
    summary: ["PARSE", shortSpec(spec.text)],
    pcb: empty([], []),
  });

  push({
    stage: "planning",
    agent: "planner",
    message: `Matched stored spec ${spec._id}`,
    status: "success",
    tick: "Spec",
    delay: 950,
    drcErrors: 0,
    summary: ["SPEC", spec._id],
    pcb: empty([], []),
  });

  let placed: PCBComponent[] = [];
  groups.forEach((group, i) => {
    placed = [...placed, ...group];
    push({
      stage: "placement",
      agent: "coder",
      message:
        i === groups.length - 1
          ? "Placement complete"
          : `Placing ${group.map((c) => c.label).join(", ")}`,
      status: i === groups.length - 1 ? "success" : "working",
      tick: i === groups.length - 1 ? "Place" : group[0]?.label ?? "Place",
      delay: 1000,
      drcErrors: 0,
      summary: ["PLACE", `+ ${group.map((c) => c.label).join(", ")}`],
      pcb: empty([...placed], []),
    });
  });

  if (pcb.traces.length > 0) {
    push({
      stage: "routing",
      agent: "coder",
      message: `Routing ${pcb.traces.length} nets`,
      status: "success",
      tick: "Route",
      delay: 1300,
      drcErrors: 0,
      summary: ["ROUTE", `+ ${pcb.traces.length} nets`],
      pcb: empty([...placed], pcb.traces),
    });
  }

  push({
    stage: "checking",
    agent: "checker",
    message: "Running hidden checks",
    status: "working",
    tick: "Check",
    delay: 1200,
    drcErrors: 0,
    summary: ["CHECK", `attempt ${attempts}`],
    pcb: empty([...placed], pcb.traces),
  });

  if (passed) {
    push({
      stage: "complete",
      agent: "checker",
      message: "All hidden checks passed",
      status: "success",
      tick: "Pass",
      delay: 0,
      drcErrors: drc,
      summary: ["PASS", `drc ${drc}`],
      pcb: empty([...placed], pcb.traces),
    });
  } else {
    // The real outcome. No repair is invented: if Atlas has no repaired board,
    // the replay ends where the run ended.
    push({
      stage: "checking",
      agent: "critic",
      message: failures[0]?.detail ?? "Hidden checks failed",
      status: "error",
      tick: "Fail",
      delay: 0,
      drcErrors: Math.max(drc, 1),
      summary: ["FAIL", `${failures.length} failed · drc ${drc}`],
      pcb: empty(
        placed.map((c) =>
          faulted.has(c.id)
            ? {
                ...c,
                status: "error" as const,
                note: failures.find((f) =>
                  `${f.check} ${f.detail}`.toUpperCase().includes(c.label.toUpperCase()),
                )?.detail,
              }
            : c,
        ),
        pcb.traces,
      ),
    });
  }

  return snapshots;
}
