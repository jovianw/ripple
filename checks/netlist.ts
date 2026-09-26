// Netlist index over Circuit JSON: resolves "U1.VCC" pin refs and "VCC" net refs
// to electrical nets (tscircuit's subcircuit_connectivity_map_key) and pad positions.
import type { AnyCircuitElement } from "circuit-json"
import type { NetRef, PinRef, TwoTerminalKind } from "./expected.ts"

export interface PortInfo {
  ref: string; // "U1.VCC"
  component: string; // "U1"
  name: string; // "VCC"
  hints: string[]; // ["VCC", "pin1", "1"]
  source_port_id: string;
  net: string | undefined; // connectivity key; undefined when unconnected
  x?: number;
  y?: number;
}

export interface ComponentInfo {
  name: string;
  source_component_id: string;
  ftype?: string;
  resistance?: number;
  capacitance?: number;
  display_resistance?: string;
  display_capacitance?: string;
  ports: PortInfo[];
}

type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

export class Netlist {
  readonly components = new Map<string, ComponentInfo>();
  /** Named nets: name -> connectivity key. */
  readonly namedNets = new Map<string, string>();
  readonly groundKeys = new Set<string>();

  constructor(readonly json: AnyCircuitElement[]) {
    const byId = new Map<string, ComponentInfo>();
    for (const e of json) {
      if (e.type !== "source_component") continue;
      const c = e as any;
      const info: ComponentInfo = {
        name: c.name,
        source_component_id: c.source_component_id,
        ftype: c.ftype,
        resistance: c.resistance,
        capacitance: c.capacitance,
        display_resistance: c.display_resistance,
        display_capacitance: c.display_capacitance,
        ports: [],
      };
      byId.set(c.source_component_id, info);
      this.components.set(c.name, info);
    }
    const pcbPortBySource = new Map<string, { x: number; y: number }>();
    for (const e of json) {
      if (e.type !== "pcb_port") continue;
      const p = e as any;
      if (p.source_port_id) pcbPortBySource.set(p.source_port_id, { x: p.x, y: p.y });
    }
    for (const e of json) {
      if (e.type !== "source_port") continue;
      const p = e as any;
      const comp = byId.get(p.source_component_id);
      if (!comp) continue;
      const pos = pcbPortBySource.get(p.source_port_id);
      comp.ports.push({
        ref: `${comp.name}.${p.name}`,
        component: comp.name,
        name: p.name,
        hints: [p.name, ...(p.port_hints ?? []), p.pin_number != null ? `pin${p.pin_number}` : undefined, p.pin_number != null ? String(p.pin_number) : undefined].filter(Boolean),
        source_port_id: p.source_port_id,
        net: p.subcircuit_connectivity_map_key,
        x: pos?.x,
        y: pos?.y,
      });
    }
    for (const e of json) {
      if (e.type !== "source_net") continue;
      const n = e as any;
      if (n.subcircuit_connectivity_map_key) {
        this.namedNets.set(n.name, n.subcircuit_connectivity_map_key);
        if (n.is_ground) this.groundKeys.add(n.subcircuit_connectivity_map_key);
      }
    }
  }

  /** "U1.VCC" -> the port. Matches by name, port hint, or pin number. */
  resolvePin(ref: PinRef | string): Resolved<PortInfo> {
    const dot = ref.indexOf(".");
    if (dot <= 0) return { ok: false, error: `${ref} is not a pin reference (expected COMPONENT.PIN)` };
    const compName = ref.slice(0, dot);
    const pinName = ref.slice(dot + 1);
    const comp = this.components.get(compName);
    if (!comp) return { ok: false, error: `${ref}: no component named ${compName} (have ${[...this.components.keys()].join(", ") || "none"})` };
    const port = comp.ports.find((p) => p.name === pinName) ?? comp.ports.find((p) => p.hints.includes(pinName));
    if (!port) return { ok: false, error: `${ref}: pin ${pinName} not found on ${compName} (pins: ${comp.ports.map((p) => p.name).join(", ")})` };
    return { ok: true, value: port };
  }

  /** Human-readable form of a NetRef for messages. */
  static refName(ref: NetRef): string {
    return typeof ref === "string" ? ref : `${ref.any_pin_of}.*${ref.except?.length ? ` except ${ref.except.join(", ")}` : ""}`;
  }

  /** Any NetRef -> the set of candidate connectivity keys (one for plain refs). */
  resolveNetSet(ref: NetRef): Resolved<string[]> {
    if (typeof ref === "string") {
      const r = this.resolveNet(ref);
      return r.ok ? { ok: true, value: [r.value] } : r;
    }
    const comp = this.components.get(ref.any_pin_of);
    if (!comp) return { ok: false, error: `no component named ${ref.any_pin_of} (have ${[...this.components.keys()].join(", ") || "none"})` };
    const excluded = new Set<string>();
    for (const ex of ref.except ?? []) {
      const r = this.resolveNet(ex);
      if (r.ok) excluded.add(r.value);
    }
    const keys = [...new Set(comp.ports.map((p) => p.net).filter((k): k is string => !!k && !excluded.has(k)))];
    if (keys.length === 0) return { ok: false, error: `${Netlist.refName(ref)}: no candidate nets (is ${ref.any_pin_of} connected?)` };
    return { ok: true, value: keys };
  }

  /** "VCC" (named net) or "U1.VCC" (pin) -> connectivity key. */
  resolveNet(ref: NetRef): Resolved<string> {
    if (typeof ref !== "string") {
      const r = this.resolveNetSet(ref);
      if (!r.ok) return r;
      if (r.value.length !== 1) return { ok: false, error: `${Netlist.refName(ref)} matches ${r.value.length} nets; a single net is required here` };
      return { ok: true, value: r.value[0] };
    }
    if (ref.includes(".")) {
      const r = this.resolvePin(ref);
      if (!r.ok) return r;
      if (!r.value.net) return { ok: false, error: `${ref} is not connected to anything` };
      return { ok: true, value: r.value.net };
    }
    const key = this.namedNets.get(ref);
    if (!key) return { ok: false, error: `net ${ref} not found (named nets: ${[...this.namedNets.keys()].join(", ") || "none"})` };
    return { ok: true, value: key };
  }

  /** Human-readable name for a connectivity key: the named net if any, else the pins on it. */
  describeNet(key: string): string {
    for (const [name, k] of this.namedNets) if (k === key) return name;
    const pins = this.portsOnNet(key).map((p) => p.ref);
    return pins.length ? `{${pins.join(", ")}}` : key;
  }

  portsOnNet(key: string): PortInfo[] {
    const out: PortInfo[] = [];
    for (const c of this.components.values()) for (const p of c.ports) if (p.net === key) out.push(p);
    return out;
  }

  componentsOfType(ftype: string): ComponentInfo[] {
    return [...this.components.values()].filter((c) => c.ftype === ftype);
  }

  /** Two-terminal parts of a kind, each reduced to its (a, b) terminal nets. For led/diode a = anode. */
  twoTerminals(kind: TwoTerminalKind): TwoTerminal[] {
    const pattern = KIND_FTYPE[kind];
    const out: TwoTerminal[] = [];
    for (const c of this.components.values()) {
      if (!c.ftype || !pattern.test(c.ftype)) continue;
      let a: PortInfo | undefined;
      let b: PortInfo | undefined;
      let aNets: (string | undefined)[];
      let bNets: (string | undefined)[];
      if (kind === "pushbutton") {
        // pin1/pin2 are one contact, pin3/pin4 the other
        const side1 = c.ports.filter((p) => p.hints.includes("pin1") || p.hints.includes("pin2"));
        const side2 = c.ports.filter((p) => p.hints.includes("pin3") || p.hints.includes("pin4"));
        aNets = side1.map((p) => p.net);
        bNets = side2.map((p) => p.net);
        a = side1[0];
        b = side2[0];
      } else {
        a = c.ports.find((p) => p.hints.includes("anode")) ?? c.ports.find((p) => p.hints.includes("pin1")) ?? c.ports[0];
        b = c.ports.find((p) => p.hints.includes("cathode")) ?? c.ports.find((p) => p.hints.includes("pin2")) ?? c.ports[1];
        aNets = [a?.net];
        bNets = [b?.net];
      }
      if (!a || !b) continue;
      out.push({ comp: c, a, b, aNets: aNets.filter((n): n is string => !!n), bNets: bNets.filter((n): n is string => !!n), polarized: kind === "led" || kind === "diode" });
    }
    return out;
  }
}

export interface TwoTerminal {
  comp: ComponentInfo;
  a: PortInfo;
  b: PortInfo;
  aNets: string[];
  bNets: string[];
  polarized: boolean;
}

const KIND_FTYPE: Record<TwoTerminalKind, RegExp> = {
  resistor: /resistor$/,
  capacitor: /capacitor$/,
  led: /_led$/,
  diode: /_diode$/,
  pushbutton: /button/,
};

/** True when the part bridges nets a and b (either orientation unless polarized). */
export function bridges(t: TwoTerminal, a: string, b: string): boolean {
  const fwd = t.aNets.includes(a) && t.bNets.includes(b);
  if (fwd) return true;
  if (t.polarized) return false;
  return t.aNets.includes(b) && t.bNets.includes(a);
}

/** Parallel combination of resistances; undefined when the list is empty. */
export function parallel(ohms: number[]): number | undefined {
  if (ohms.length === 0) return undefined;
  return 1 / ohms.reduce((s, r) => s + 1 / r, 0);
}

export function fmtOhms(r: number): string {
  if (r >= 1e6) return `${+(r / 1e6).toFixed(2)}M`;
  if (r >= 1e3) return `${+(r / 1e3).toFixed(2)}k`;
  return `${+r.toFixed(1)}`;
}

export function fmtFarads(f: number): string {
  if (f >= 1e-6) return `${+(f * 1e6).toFixed(2)}uF`;
  if (f >= 1e-9) return `${+(f * 1e9).toFixed(2)}nF`;
  return `${+(f * 1e12).toFixed(1)}pF`;
}

export function distanceMm(a: { x?: number; y?: number }, b: { x?: number; y?: number }): number | undefined {
  if (a.x == null || a.y == null || b.x == null || b.y == null) return undefined;
  return Math.hypot(a.x - b.x, a.y - b.y);
}
