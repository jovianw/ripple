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
  substrate: "#1a6048",
  silk: "#8fb3a6",
  copper: "#c2803a",
  copperBright: "#e0a052",
  pad: "#d8c9a3",
  error: "#ff4d4d",
  repairing: "#ffb020",
  success: "#2fd27a",
  placing: "#4ea8ff",
} as const;

/**
 * Body colour and finish per package type. Types are separated by silhouette
 * and material, never by hue — moulded black for silicon, bare metal for the
 * connector, matte earth tones for passives.
 */
export const MATERIAL_BY_TYPE: Record<
  PCBComponentType,
  { color: string; metalness: number; roughness: number }
> = {
  // Moulded epoxy: dark, tight highlight along the top edge.
  ic: { color: "#101012", metalness: 0.35, roughness: 0.32 },
  module: { color: "#17171a", metalness: 0.3, roughness: 0.38 },
  sensor: { color: "#1e1e24", metalness: 0.35, roughness: 0.3 },
  // Stamped shield can: clearly metal next to the epoxy parts.
  connector: { color: "#c6cad2", metalness: 0.96, roughness: 0.17 },
  // Passives stay matte so they read as small and secondary.
  resistor: { color: "#2b2118", metalness: 0.05, roughness: 0.82 },
  capacitor: { color: "#3d2c19", metalness: 0.08, roughness: 0.78 },
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
