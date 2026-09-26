// Deterministic PCB metrics derived from CircuitJson.
// bom_usd is intentionally omitted: circuit-json carries no price field
// (only exclude_from_bom/inBom booleans), so a dollar figure here would be
// fabricated, not derived.
import type { CircuitJson } from "tscircuit";

export interface CircuitMetrics {
  area_mm2?: number;
  vias: number;
  trace_mm: number;
}

type Board = Extract<CircuitJson[number], { type: "pcb_board" }>;
type Trace = Extract<CircuitJson[number], { type: "pcb_trace" }>;
type RoutePoint = Trace["route"][number];

function isBoard(el: CircuitJson[number]): el is Board {
  return el.type === "pcb_board";
}

function isTrace(el: CircuitJson[number]): el is Trace {
  return el.type === "pcb_trace";
}

function entryXY(point: RoutePoint): { x: number; y: number } {
  return point.route_type === "through_pad" ? point.start : point;
}

function exitXY(point: RoutePoint): { x: number; y: number } {
  return point.route_type === "through_pad" ? point.end : point;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function traceLength(trace: Trace): number {
  if (typeof trace.trace_length === "number") return trace.trace_length;

  let length = 0;
  const route = trace.route;
  for (let i = 0; i < route.length; i++) {
    const point = route[i];
    if (point.route_type === "through_pad") length += distance(point.start, point.end);
    if (i > 0) length += distance(exitXY(route[i - 1]), entryXY(point));
  }
  return length;
}

export function computeMetrics(circuitJson: CircuitJson): CircuitMetrics {
  const board = circuitJson.find(isBoard);
  const area_mm2 =
    board && typeof board.width === "number" && typeof board.height === "number"
      ? board.width * board.height
      : undefined;

  const vias = circuitJson.filter((el) => el.type === "pcb_via").length;

  const trace_mm = circuitJson.filter(isTrace).reduce((sum, trace) => sum + traceLength(trace), 0);

  return { area_mm2, vias, trace_mm };
}
