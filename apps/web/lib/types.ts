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
  /** Unit cost, summed into the BOM metric. */
  costUsd?: number;
  /** Subcircuit this part was designed in, when the board was built block by block. */
  group?: string;
  /** Ids of the parts wired directly to this one (port-to-port traces). */
  links?: string[];
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
  /** Scene units for layout, plus the physical size quoted in the metrics strip. */
  board: { width: number; height: number; widthMm: number; heightMm: number };
}

/**
 * The engineering readout. Everything except drcErrors is derived from
 * PCBState so the strip can never disagree with the board (see lib/metrics.ts).
 */
export interface DesignMetrics {
  components: number;
  nets: number;
  drcErrors: number;
  boardWidthMm: number;
  boardHeightMm: number;
  bomUsd: number;
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
  /** Design-rule errors open at this snapshot; drives the DRC readout. */
  drcErrors?: number;
  /** One or two lines shown when hovering this node in the build history. */
  summary?: string[];
}

/** Stage order, for the progress rail. */
export const STAGES: { id: BuildStage; label: string }[] = [
  { id: "planning", label: "Plan" },
  { id: "placement", label: "Place" },
  { id: "wiring", label: "Wire" },
  { id: "routing", label: "Route" },
  { id: "checking", label: "Check" },
  { id: "repair", label: "Repair" },
  { id: "complete", label: "Pass" },
];

export const EMPTY_PCB: PCBState = {
  components: [],
  traces: [],
  board: { width: 12, height: 8, widthMm: 48, heightMm: 32 },
};
