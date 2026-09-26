// Circuit JSON -> PCBState.
//
// This is the adapter the scene was designed around: PCBState stays a view
// model, and everything tscircuit-specific lives here. Element shapes are from
// real documents in the `boards` collection (see docs/frontend-backend.md §3).

import type { PCBComponent, PCBComponentType, PCBState, PCBTrace } from "./types";

/** Longest board edge, in scene units. Normalising on the *longer* side means
 *  the camera framing holds for portrait boards as well as landscape ones —
 *  scaling on width alone makes a tall board overflow the frame. */
const TARGET_EXTENT = 12;

interface El {
  type: string;
  [key: string]: unknown;
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const pt = (v: unknown): { x: number; y: number } => {
  const o = (v ?? {}) as { x?: unknown; y?: unknown };
  return { x: num(o.x), y: num(o.y) };
};

/** tscircuit ftype -> the package families the scene knows how to draw. */
const TYPE_BY_FTYPE: Record<string, PCBComponentType> = {
  simple_resistor: "resistor",
  simple_capacitor: "capacitor",
  simple_chip: "ic",
  simple_pin_header: "connector",
  simple_connector: "connector",
  simple_led: "ic",
  simple_diode: "ic",
  simple_transistor: "ic",
  simple_crystal: "ic",
  simple_switch: "connector",
  simple_push_button: "connector",
};

/** Package height above the substrate, in scene units, by family. */
const DEPTH_BY_TYPE: Record<PCBComponentType, number> = {
  connector: 0.5,
  module: 0.42,
  ic: 0.34,
  sensor: 0.24,
  capacitor: 0.12,
  resistor: 0.1,
};

const prettyFtype = (ftype: string): string =>
  ftype.replace(/^simple_/, "").replace(/_/g, " ");

export interface AdapterResult {
  pcb: PCBState;
  /** Design-rule / render errors found in the Circuit JSON itself. */
  errors: { message: string; componentId?: string }[];
  /** Vias are counted for telemetry but not drawn. */
  viaCount: number;
}

/**
 * Convert a Circuit JSON element array into something the scene can draw.
 *
 * Coordinates are millimetres with the board centred on `pcb_board.center` —
 * which is generally *not* the origin — so everything is translated by that
 * centre and then scaled to TARGET_WIDTH.
 */
export function circuitJsonToPCBState(elements: unknown): AdapterResult {
  const els: El[] = Array.isArray(elements) ? (elements as El[]) : [];

  const board = els.find((e) => e.type === "pcb_board");
  const boardWidthMm = num(board?.width, 40);
  const boardHeightMm = num(board?.height, 30);
  const origin = pt(board?.center);
  const longestMm = Math.max(boardWidthMm, boardHeightMm);
  const scale = longestMm > 0 ? TARGET_EXTENT / longestMm : 1;

  // Board plane -> scene plane: recentre, then normalise size.
  const mapX = (x: number) => (x - origin.x) * scale;
  const mapY = (y: number) => (y - origin.y) * scale;

  const sources = new Map<string, El>();
  for (const e of els) {
    if (e.type === "source_component" && typeof e.source_component_id === "string") {
      sources.set(e.source_component_id, e);
    }
  }

  // Errors first, so a component can be marked as it is built.
  const errors: { message: string; componentId?: string }[] = [];
  for (const e of els) {
    if (!e.type.endsWith("_error")) continue;
    errors.push({
      message:
        (typeof e.message === "string" && e.message) ||
        e.type.replace(/_/g, " "),
      componentId:
        typeof e.pcb_component_id === "string" ? e.pcb_component_id : undefined,
    });
  }
  const erroredComponents = new Set(
    errors.map((e) => e.componentId).filter((x): x is string => Boolean(x)),
  );

  const components: PCBComponent[] = [];
  for (const e of els) {
    if (e.type !== "pcb_component") continue;

    const id = typeof e.pcb_component_id === "string" ? e.pcb_component_id : "";
    const source =
      typeof e.source_component_id === "string"
        ? sources.get(e.source_component_id)
        : undefined;
    const ftype = typeof source?.ftype === "string" ? source.ftype : "";
    const type = TYPE_BY_FTYPE[ftype] ?? "ic";
    const center = pt(e.center);

    // width/height are the bounding box *after* rotation, so the rotation must
    // not be applied again here — doing both turns R1 sideways twice.
    components.push({
      id: id || `${e.source_component_id}`,
      type,
      label: typeof source?.name === "string" ? source.name : (id || "?"),
      shortName: ftype ? prettyFtype(ftype) : undefined,
      part: ftype ? prettyFtype(ftype) : undefined,
      position: { x: mapX(center.x), y: mapY(center.y) },
      size: {
        width: Math.max(0.08, num(e.width) * scale),
        height: Math.max(0.08, num(e.height) * scale),
        depth: DEPTH_BY_TYPE[type],
      },
      status: erroredComponents.has(id) ? "error" : undefined,
      note: erroredComponents.has(id)
        ? errors.find((x) => x.componentId === id)?.message
        : undefined,
    });
  }

  const traces: PCBTrace[] = [];
  for (const e of els) {
    if (e.type !== "pcb_trace") continue;
    const route = Array.isArray(e.route) ? (e.route as El[]) : [];

    // Only wire segments carry geometry; via hops repeat a point.
    const points = route
      .filter((r) => r.route_type !== "via")
      .map((r) => ({ x: mapX(num(r.x)), y: mapY(num(r.y)) }));
    if (points.length < 2) continue;

    const widthMm = num(route.find((r) => typeof r.width === "number")?.width, 0.15);
    traces.push({
      id: typeof e.pcb_trace_id === "string" ? e.pcb_trace_id : `trace_${traces.length}`,
      points,
      // drei's Line width is in screen space; map the physical width into a
      // range that stays legible without drowning the board.
      width: Math.min(4.5, Math.max(1.4, widthMm * 16)),
    });
  }

  return {
    pcb: {
      components,
      traces,
      board: {
        width: boardWidthMm * scale,
        height: boardHeightMm * scale,
        widthMm: Math.round(boardWidthMm * 10) / 10,
        heightMm: Math.round(boardHeightMm * 10) / 10,
      },
    },
    errors,
    viaCount: els.filter((e) => e.type === "pcb_via").length,
  };
}
