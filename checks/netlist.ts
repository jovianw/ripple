// Netlist index over Circuit JSON: resolves "U1.VCC" pin refs and "VCC" net refs
// to electrical nets (tscircuit's subcircuit_connectivity_map_key) and pad positions.
import type { AnyCircuitElement } from "circuit-json"
import type { NetRef, PinRef } from "./expected.ts"

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

  /** "VCC" (named net) or "U1.VCC" (pin) -> connectivity key. */
  resolveNet(ref: NetRef): Resolved<string> {
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
}

export function distanceMm(a: { x?: number; y?: number }, b: { x?: number; y?: number }): number | undefined {
  if (a.x == null || a.y == null || b.x == null || b.y == null) return undefined;
  return Math.hypot(a.x - b.x, a.y - b.y);
}
