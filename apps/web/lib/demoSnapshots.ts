// The scripted build. This is the ONLY file that knows the demo is fake.
//
// Replacing it with a backend feed means producing the same BuildSnapshot[]
// from an API or change stream — no component below this layer changes.

import type {
  BuildSnapshot,
  PCBComponent,
  PCBState,
  PCBStatus,
  PCBTrace,
} from "./types";

export const DEFAULT_PROMPT =
  "Build a USB-C powered temperature sensor board with an ESP32.";

const BOARD = { width: 12, height: 8, widthMm: 48, heightMm: 32 };

// ---------------------------------------------------------------- components

const J1: PCBComponent = {
  id: "J1",
  type: "connector",
  label: "J1",
  part: "USB-C receptacle",
  shortName: "USB-C",
  position: { x: -4.9, y: 0 },
  size: { width: 1.5, height: 1.2, depth: 0.5 },
  placedDuring: "placement",
  costUsd: 0.86,
};

const U1: PCBComponent = {
  id: "U1",
  type: "module",
  label: "U1",
  part: "ESP32-S3",
  shortName: "ESP32-S3",
  position: { x: 0.2, y: -0.3 },
  size: { width: 3.6, height: 2.4, depth: 0.42 },
  placedDuring: "placement",
  costUsd: 2.1,
};

const U2: PCBComponent = {
  id: "U2",
  type: "ic",
  label: "U2",
  part: "3.3V regulator",
  shortName: "REGULATOR",
  position: { x: -3.0, y: 1.3 },
  size: { width: 1.0, height: 0.9, depth: 0.3 },
  placedDuring: "placement",
  costUsd: 0.42,
};

const U3: PCBComponent = {
  id: "U3",
  type: "sensor",
  label: "U3",
  part: "I2C temperature sensor",
  shortName: "TEMP SENSOR",
  position: { x: 4.0, y: 1.3 },
  size: { width: 0.85, height: 0.85, depth: 0.24 },
  placedDuring: "placement",
  costUsd: 0.64,
};

const C1: PCBComponent = {
  id: "C1",
  type: "capacitor",
  label: "C1",
  part: "10uF input bulk",
  position: { x: -4.0, y: 2.2 },
  size: { width: 0.42, height: 0.3, depth: 0.12 },
  placedDuring: "placement",
  costUsd: 0.06,
};

const C2: PCBComponent = {
  id: "C2",
  type: "capacitor",
  label: "C2",
  part: "10uF output bulk",
  position: { x: -1.9, y: 2.2 },
  size: { width: 0.42, height: 0.3, depth: 0.12 },
  placedDuring: "placement",
  costUsd: 0.06,
};

const C3: PCBComponent = {
  id: "C3",
  type: "capacitor",
  label: "C3",
  part: "100nF MCU decoupling",
  position: { x: -1.5, y: -2.0 },
  size: { width: 0.42, height: 0.3, depth: 0.12 },
  placedDuring: "placement",
  costUsd: 0.03,
};

const R1: PCBComponent = {
  id: "R1",
  type: "resistor",
  label: "R1",
  part: "4.7k SDA pull-up",
  position: { x: 2.9, y: 2.5 },
  size: { width: 0.42, height: 0.24, depth: 0.10 },
  placedDuring: "placement",
  costUsd: 0.02,
};

const R2: PCBComponent = {
  id: "R2",
  type: "resistor",
  label: "R2",
  part: "4.7k SCL pull-up",
  position: { x: 3.7, y: 2.5 },
  size: { width: 0.42, height: 0.24, depth: 0.10 },
  placedDuring: "placement",
  costUsd: 0.02,
};

/** The repair part — absent until the critic finds the fault. */
const C7: PCBComponent = {
  id: "C7",
  type: "capacitor",
  label: "C7",
  part: "100nF decoupling",
  position: { x: -3.0, y: 0.35 },
  size: { width: 0.42, height: 0.3, depth: 0.12 },
  placedDuring: "repair",
  costUsd: 0.03,
};

// -------------------------------------------------------------------- traces

const T_VBUS: PCBTrace = {
  id: "t_vbus",
  width: 3.2,
  points: [
    { x: -4.1, y: 0.25 },
    { x: -3.6, y: 0.25 },
    { x: -3.6, y: 1.3 },
    { x: -3.5, y: 1.3 },
  ],
};

const T_GND: PCBTrace = {
  id: "t_gnd",
  width: 3.2,
  points: [
    { x: -4.1, y: -0.3 },
    { x: -2.4, y: -0.3 },
    { x: -2.4, y: -0.9 },
    { x: -1.6, y: -0.9 },
  ],
};

const T_3V3: PCBTrace = {
  id: "t_3v3",
  width: 3.2,
  points: [
    { x: -2.5, y: 1.3 },
    { x: -1.9, y: 1.3 },
    { x: -1.9, y: 0.5 },
    { x: -1.6, y: 0.5 },
  ],
};

const T_SDA: PCBTrace = {
  id: "t_sda",
  points: [
    { x: 2.0, y: 0.6 },
    { x: 2.9, y: 0.6 },
    { x: 2.9, y: 1.15 },
    { x: 3.6, y: 1.15 },
  ],
};

const T_SCL: PCBTrace = {
  id: "t_scl",
  points: [
    { x: 2.0, y: 0.1 },
    { x: 3.3, y: 0.1 },
    { x: 3.3, y: 1.45 },
    { x: 3.6, y: 1.45 },
  ],
};

const T_PU1: PCBTrace = {
  id: "t_pu1",
  points: [
    { x: 2.9, y: 2.38 },
    { x: 2.9, y: 1.15 },
  ],
};

const T_PU2: PCBTrace = {
  id: "t_pu2",
  points: [
    { x: 3.7, y: 2.38 },
    { x: 3.7, y: 1.8 },
    { x: 3.3, y: 1.8 },
    { x: 3.3, y: 1.45 },
  ],
};

const T_C1: PCBTrace = {
  id: "t_c1",
  points: [
    { x: -4.0, y: 2.05 },
    { x: -4.0, y: 1.3 },
    { x: -3.5, y: 1.3 },
  ],
};

const T_C2: PCBTrace = {
  id: "t_c2",
  points: [
    { x: -1.9, y: 2.05 },
    { x: -1.9, y: 1.3 },
    { x: -2.5, y: 1.3 },
  ],
};

const T_C3: PCBTrace = {
  id: "t_c3",
  points: [
    { x: -1.5, y: -1.85 },
    { x: -1.5, y: -1.5 },
  ],
};

/** Repair net: U2 VDD down to the new decoupling cap. */
const T_C7: PCBTrace = {
  id: "t_c7",
  points: [
    { x: -3.0, y: 0.85 },
    { x: -3.0, y: 0.5 },
  ],
};

// --------------------------------------------------------------------- utils

const withStatus = (
  component: PCBComponent,
  status: PCBStatus,
  note?: string,
): PCBComponent => ({ ...component, status, note });

const traceStatus = (trace: PCBTrace, status: PCBTrace["status"]): PCBTrace => ({
  ...trace,
  status,
});

const pcb = (components: PCBComponent[], traces: PCBTrace[]): PCBState => ({
  board: BOARD,
  components,
  traces,
});

const PLACED_ALL = [J1, U2, C1, C2, U1, C3, U3, R1, R2];
const WIRED = [T_VBUS, T_GND, T_3V3];
const ROUTED = [...WIRED, T_SDA, T_SCL, T_PU1, T_PU2, T_C1, T_C2, T_C3];

let clock = 0;
const nextTs = (ms: number): number => (clock += ms);

// ----------------------------------------------------------------- snapshots

export const DEMO_SNAPSHOTS: BuildSnapshot[] = [
  {
    version: 0,
    stage: "planning",
    agent: "planner",
    message: "Parsing requirements",
    status: "working",
    tick: "Parse",
    drcErrors: 0,
    summary: ["PARSE", "Requirements read"],
    delay: 900,
    timestamp: nextTs(900),
    pcb: pcb([], []),
  },
  {
    version: 1,
    stage: "planning",
    agent: "planner",
    message: "Identified power, MCU, and sensor blocks",
    status: "success",
    tick: "Plan",
    drcErrors: 0,
    summary: ["PLAN", "Power, MCU and sensor blocks"],
    delay: 1000,
    timestamp: nextTs(1000),
    pcb: pcb([], []),
  },
  {
    version: 2,
    stage: "placement",
    agent: "coder",
    message: "Placing ESP32-S3",
    status: "working",
    tick: "MCU",
    drcErrors: 0,
    summary: ["PLACE", "+ U1 ESP32-S3"],
    delay: 1100,
    timestamp: nextTs(1100),
    pcb: pcb([U1], []),
  },
  {
    version: 3,
    stage: "placement",
    agent: "coder",
    message: "Adding USB-C power stage",
    status: "working",
    tick: "Power",
    drcErrors: 0,
    summary: ["PLACE", "+ J1 USB-C, + U2 regulator"],
    delay: 1100,
    timestamp: nextTs(1100),
    pcb: pcb([U1, J1, U2], []),
  },
  {
    version: 4,
    stage: "placement",
    agent: "coder",
    message: "Placing sensor and passives",
    status: "success",
    tick: "Place",
    drcErrors: 0,
    summary: ["PLACE", "+ U3, C1-C3, R1, R2"],
    delay: 1100,
    timestamp: nextTs(1100),
    pcb: pcb(PLACED_ALL, []),
  },
  {
    version: 5,
    stage: "wiring",
    agent: "coder",
    message: "Connecting power nets",
    status: "working",
    tick: "Power net",
    drcErrors: 0,
    summary: ["WIRE", "+ 3 power nets"],
    delay: 1200,
    timestamp: nextTs(1200),
    pcb: pcb(PLACED_ALL, WIRED),
  },
  {
    version: 6,
    stage: "routing",
    agent: "coder",
    message: "Routing I2C bus and passives",
    status: "success",
    tick: "Route",
    drcErrors: 0,
    summary: ["ROUTE", "+ 7 signal nets"],
    delay: 1300,
    timestamp: nextTs(1300),
    pcb: pcb(PLACED_ALL, ROUTED),
  },
  {
    version: 7,
    stage: "checking",
    agent: "checker",
    message: "Running design checks",
    status: "working",
    tick: "Check",
    drcErrors: 0,
    summary: ["CHECK", "Running design rules"],
    delay: 1100,
    timestamp: nextTs(1100),
    pcb: pcb(PLACED_ALL, ROUTED),
  },
  {
    version: 8,
    stage: "checking",
    agent: "critic",
    message: "U2 VDD has no 100nF decoupling capacitor nearby",
    status: "error",
    tick: "Fail",
    drcErrors: 1,
    summary: ["FAIL", "U2 decoupling check failed"],
    delay: 2100,
    timestamp: nextTs(1700),
    pcb: pcb(
      PLACED_ALL.map((c) =>
        c.id === "U2"
          ? withStatus(c, "error", "No decoupling capacitor within 3mm of VDD")
          : c,
      ),
      ROUTED.map((t) => (t.id === "t_3v3" ? traceStatus(t, "error") : t)),
    ),
  },
  {
    version: 9,
    stage: "repair",
    agent: "coder",
    message: "Adding C7 100nF decoupling capacitor",
    status: "warning",
    tick: "Fix",
    drcErrors: 1,
    summary: ["FIX", "+ C7 100nF"],
    delay: 1600,
    timestamp: nextTs(1400),
    pcb: pcb(
      [
        ...PLACED_ALL.map((c) =>
          c.id === "U2" ? withStatus(c, "repairing", "Adding C7 · 100nF") : c,
        ),
        withStatus(C7, "new"),
      ],
      ROUTED.map((t) => (t.id === "t_3v3" ? traceStatus(t, "repairing") : t)),
    ),
  },
  {
    version: 10,
    stage: "repair",
    agent: "coder",
    message: "Repair complete — VDD net re-routed",
    status: "success",
    tick: "Repaired",
    drcErrors: 0,
    summary: ["FIX", "+ 1 trace updated"],
    delay: 1300,
    timestamp: nextTs(1200),
    pcb: pcb([...PLACED_ALL, C7], [...ROUTED, traceStatus(T_C7, "new")]),
  },
  {
    version: 11,
    stage: "complete",
    agent: "checker",
    message: "All checks passed",
    status: "success",
    tick: "Done",
    drcErrors: 0,
    summary: ["PASS", "All design checks passed"],
    delay: 0,
    timestamp: nextTs(600),
    // Completion reads through the header chip and stage rail, not by
    // painting every package green.
    pcb: pcb([...PLACED_ALL, C7], [...ROUTED, T_C7]),
  },
];

/** Total scripted runtime, for the "~Ns" hint under the Build button. */
export const DEMO_DURATION_MS = DEMO_SNAPSHOTS.reduce(
  (total, snapshot) => total + (snapshot.delay ?? 0),
  0,
);
