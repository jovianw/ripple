// Deterministic PCB metrics derived from CircuitJson: size, routing quality, part count and BOM cost.
// Every field is required; a board they can't be computed for throws a MetricsError (the coder turns
// that into a failed attempt with the message, so the critic can fix it).
import type { CircuitJson } from "tscircuit";
import type { RunQuality } from "../harness/quality.js";
import { partsWhitelist } from "./parts-whitelist.js";

/**
 * area_mm2: board outline. density: component footprint area ÷ board area. connections: Σ over nets of (ports − 1).
 * detour: trace_mm ÷ Σ per-net minimum spanning tree length over pad positions (1.0 = straight lines).
 * parts: source components. bom_usd: Σ whitelist unit prices.
 */
export type CircuitMetrics = RunQuality;

export class MetricsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricsError";
  }
}

type El = CircuitJson[number];
type Of<T extends El["type"]> = Extract<El, { type: T }>;
type Trace = Of<"pcb_trace">;
type RoutePoint = Trace["route"][number];
type XY = { x: number; y: number };

const ofType = <T extends El["type"]>(json: CircuitJson, type: T) => json.filter((e): e is Of<T> => e.type === type);

function entryXY(point: RoutePoint): XY {
  return point.route_type === "through_pad" ? point.start : point;
}

function exitXY(point: RoutePoint): XY {
  return point.route_type === "through_pad" ? point.end : point;
}

function distance(a: XY, b: XY): number {
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

/** Nets as groups of source port ids: union-find over each source trace's ports and named nets. */
function nets(json: CircuitJson): string[][] {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const t of ofType(json, "source_trace")) {
    const keys = [...t.connected_source_port_ids.map((id) => `port:${id}`), ...t.connected_source_net_ids.map((id) => `net:${id}`)];
    for (const k of keys) if (!parent.has(k)) parent.set(k, k);
    for (const k of keys.slice(1)) union(keys[0], k);
  }
  const groups = new Map<string, string[]>();
  for (const k of parent.keys()) {
    if (!k.startsWith("port:")) continue;
    const root = find(k);
    groups.set(root, [...(groups.get(root) ?? []), k.slice("port:".length)]);
  }
  return [...groups.values()];
}

/** Prim's minimum spanning tree length over points (a lower bound, up to Steiner points, on routing one net). */
function mstLength(points: XY[]): number {
  if (points.length < 2) return 0;
  const inTree = new Array(points.length).fill(false);
  const best = points.map((p) => distance(points[0], p));
  inTree[0] = true;
  let total = 0;
  for (let n = 1; n < points.length; n++) {
    let next = -1;
    for (let i = 0; i < points.length; i++) if (!inTree[i] && (next < 0 || best[i] < best[next])) next = i;
    inTree[next] = true;
    total += best[next];
    for (let i = 0; i < points.length; i++) if (!inTree[i]) best[i] = Math.min(best[i], distance(points[next], points[i]));
  }
  return total;
}

// circuit-json ftype -> whitelist element
const ELEMENT_FOR_FTYPE: Record<string, string> = {
  simple_resistor: "resistor",
  simple_capacitor: "capacitor",
  simple_led: "led",
  simple_diode: "diode",
  simple_push_button: "pushbutton",
  simple_crystal: "crystal",
  simple_pin_header: "pinheader",
  simple_chip: "chip",
};

/**
 * The whitelist footprint a rendered footprint string came from. tscircuit decorates passives and headers
 * ("0603" -> "res0603", "cap0603", "0603_color(red)"; "pinrow2" -> "pinrow2_nopinlabels"); chips keep theirs.
 */
function whitelistFootprint(element: string, rendered: string): string {
  if (element === "chip") return rendered;
  return rendered.replace(/^(res|cap)(?=\d)/, "").replace(/_(color\([^)]*\)|nopinlabels)$/, "");
}

/** Whitelist unit price for every source component; throws naming any component that isn't a whitelisted part. */
function bomUsd(json: CircuitJson): number {
  const footprintOf = new Map(ofType(json, "cad_component").map((c) => [c.source_component_id, c.footprinter_string]));
  const off: string[] = [];
  let total = 0;
  for (const c of ofType(json, "source_component")) {
    const element = ELEMENT_FOR_FTYPE[c.ftype ?? ""];
    const rendered = footprintOf.get(c.source_component_id);
    const footprint = element && rendered ? whitelistFootprint(element, rendered) : rendered;
    const mpn = "manufacturer_part_number" in c ? c.manufacturer_part_number : undefined;
    const part = partsWhitelist.find(
      (p) =>
        p.element === element &&
        p.props.footprint === footprint &&
        (element !== "chip" || p.props.manufacturerPartNumber === mpn),
    );
    if (part) total += part.unit_price_usd;
    else off.push(`${c.name} (${element ?? c.ftype}${rendered ? ` ${rendered}` : ", no footprint"}${mpn ? ` ${mpn}` : ""})`);
  }
  if (off.length) throw new MetricsError(`not on the parts whitelist: ${off.join(", ")}`);
  return total;
}

export function computeMetrics(circuitJson: CircuitJson): CircuitMetrics {
  const board = circuitJson.find((e): e is Of<"pcb_board"> => e.type === "pcb_board");
  if (!board || typeof board.width !== "number" || typeof board.height !== "number")
    throw new MetricsError("no sized <board> in the rendered circuit");
  const area_mm2 = board.width * board.height;

  const componentArea = ofType(circuitJson, "pcb_component").reduce((s, c) => s + c.width * c.height, 0);

  const portXY = new Map(ofType(circuitJson, "pcb_port").map((p) => [p.source_port_id, { x: p.x, y: p.y }]));
  let connections = 0;
  let ideal_mm = 0;
  for (const ports of nets(circuitJson)) {
    const points = ports.map((id) => {
      const xy = portXY.get(id);
      if (!xy) throw new MetricsError(`source port ${id} has no pad on the board`);
      return xy;
    });
    connections += points.length - 1;
    ideal_mm += mstLength(points);
  }
  if (connections === 0 || ideal_mm === 0) throw new MetricsError("the board has no connections to route");

  const trace_mm = ofType(circuitJson, "pcb_trace").reduce((sum, trace) => sum + traceLength(trace), 0);

  return {
    area_mm2,
    density: componentArea / area_mm2,
    vias: ofType(circuitJson, "pcb_via").length,
    trace_mm,
    connections,
    detour: trace_mm / ideal_mm,
    parts: ofType(circuitJson, "source_component").length,
    bom_usd: bomUsd(circuitJson),
  };
}
