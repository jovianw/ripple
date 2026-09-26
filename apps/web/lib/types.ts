// Frontend-only view model for the PCB. Deliberately NOT Circuit JSON — when the
// real backend lands, write an adapter (CircuitJSON -> PCBState) and everything
// downstream of this file keeps working unchanged.
//
// Coordinates are board-plane units with the origin at the board centre:
//   x runs left->right, y runs bottom->top. The scene maps y onto -Z.

export type PCBComponentType =
  | "ic"
  | "resistor"
  | "capacitor"
  | "connector"
  | "sensor"
  | "module";

export type PCBStatus = "normal" | "new" | "error" | "repairing" | "success";

export interface PCBComponent {
  id: string;
  type: PCBComponentType;
  label: string;
  /** Long-form name shown in the inspector, e.g. "I2C temperature sensor". */
  part?: string;
  /** Short name for the 3D label; long part names collide in the scene. */
  shortName?: string;
  position: { x: number; y: number };
  /** Radians, about the board normal. */
  rotation?: number;
  size?: { width: number; height: number; depth?: number };
  status?: PCBStatus;
  /** Stage this part was placed during — shown in the inspector. */
  placedDuring?: BuildStage;
  /** Shown in the inspector when status is "error". */
  note?: string;
}

export type PCBTraceStatus = "normal" | "new" | "error" | "repairing";

export interface PCBTrace {
  id: string;
  points: Array<{ x: number; y: number }>;
  status?: PCBTraceStatus;
  /** Wider traces for power nets. */
  width?: number;
}

export interface PCBState {
  components: PCBComponent[];
  traces: PCBTrace[];
  board: { width: number; height: number };
}

export type BuildStage =
  | "planning"
  | "placement"
  | "wiring"
  | "routing"
  | "checking"
  | "repair"
  | "complete";

export type AgentName = "planner" | "coder" | "critic" | "checker" | "meta";

export type SnapshotStatus = "working" | "success" | "warning" | "error";

export interface BuildSnapshot {
  version: number;
  stage: BuildStage;
  pcb: PCBState;
  agent: AgentName;
  message: string;
  status: SnapshotStatus;
  timestamp: number;
  /** ms to hold before advancing to the next snapshot. */
  delay?: number;
  /** Short label for the build-history timeline. */
  tick: string;
}

/** Stage order, for the progress rail. */
export const STAGES: { id: BuildStage; label: string }[] = [
  { id: "planning", label: "Plan" },
  { id: "placement", label: "Placement" },
  { id: "wiring", label: "Wiring" },
  { id: "routing", label: "Routing" },
  { id: "checking", label: "Checks" },
  { id: "repair", label: "Repair" },
  { id: "complete", label: "Done" },
];

export const EMPTY_PCB: PCBState = {
  components: [],
  traces: [],
  board: { width: 12, height: 8 },
};
