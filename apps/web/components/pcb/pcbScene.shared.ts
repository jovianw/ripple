// Shared scene constants and the board-plane -> world mapping.
//
// Board coords are (x, y) with the origin at the board centre. The board lies in
// the world XZ plane, so board y maps onto -Z (board "up" is away from camera).

import type { PCBComponentType, PCBStatus } from "@/lib/types";

export const BOARD_THICKNESS = 0.28;
/** Top face of the substrate; everything sits on or above this. */
export const BOARD_TOP = BOARD_THICKNESS / 2;
/** Traces float just clear of the substrate to avoid z-fighting. */
export const TRACE_LIFT = 0.014;

export const toWorld = (x: number, y: number): [number, number, number] => [
  x,
  BOARD_TOP,
  -y,
];

export const COLORS = {
  substrate: "#0e3b2c",
  silk: "#8fb3a6",
  copper: "#c2803a",
  copperBright: "#e0a052",
  pad: "#d8c9a3",
  error: "#ff4d4d",
  repairing: "#ffb020",
  success: "#2fd27a",
  placing: "#4ea8ff",
} as const;

/** Body colour and finish per package type. */
export const MATERIAL_BY_TYPE: Record<
  PCBComponentType,
  { color: string; metalness: number; roughness: number }
> = {
  ic: { color: "#141414", metalness: 0.25, roughness: 0.55 },
  module: { color: "#1b1b1d", metalness: 0.2, roughness: 0.6 },
  sensor: { color: "#23232a", metalness: 0.25, roughness: 0.5 },
  connector: { color: "#b8bcc4", metalness: 0.9, roughness: 0.28 },
  resistor: { color: "#2b2118", metalness: 0.1, roughness: 0.7 },
  capacitor: { color: "#3a2b1a", metalness: 0.15, roughness: 0.65 },
};

/** Emissive tint used while a part is in a given state. */
export const STATUS_EMISSIVE: Record<PCBStatus, string | null> = {
  normal: null,
  new: COLORS.placing,
  error: COLORS.error,
  repairing: COLORS.repairing,
  success: COLORS.success,
};

export const DEFAULT_SIZE = { width: 0.5, height: 0.35, depth: 0.2 };
