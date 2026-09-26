// Netlist index over Circuit JSON: resolves pin and net references to electrical nets
// (tscircuit's subcircuit_connectivity_map_key) and pad positions.
//
// Pin references (see expected.ts):
//   "U1.VCC"                a component by name
//   "header:SDA"            every pin-header pin labelled SDA (case-insensitive)
//   "role:temp_sensor.VCC"  canonical pin VCC on every whitelisted part with that role
//   "part:mcu_attiny85.VCC" canonical pin VCC on every instance of that whitelisted part
import type { AnyCircuitElement } from "circuit-json"
import type { NetRef, PinRef } from "./expected.ts"
import { partForMpn, pinNumberFor, whitelistParts, type WhitelistPart } from "./whitelist.ts"

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
  mpn?: string;
  /** Whitelisted part this component was matched to, if any. */
  part?: WhitelistPart;
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
        mpn: c.manufacturer_part_number,
        part: partForMpn(c.manufacturer_part_number),
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

  /** "role:mcu" / "part:mcu_attiny85" / "U1" -> matching components. */
  resolveComponents(sel: string): Resolved<ComponentInfo[]> {
    const m = /^(role|part):(.+)$/.exec(sel);
    if (!m) {
      const c = this.components.get(sel);
      return c ? { ok: true, value: [c] } : { ok: false, error: `no component named ${sel}` };
    }
    const [, kind, key] = m;
    if (kind === "part" && !whitelistParts.some((p) => p.id === key)) return { ok: false, error: `unknown whitelist part ${key}` };
    const found = [...this.components.values()].filter((c) => c.part && (kind === "part" ? c.part.id === key : c.part.roles?.includes(key)));
    if (found.length === 0) return { ok: false, error: `no ${kind === "role" ? key : `${key} part`} on the board` };
    return { ok: true, value: found };
  }

  /** A pin on a component: by canonical name (whitelisted parts), name, hint, or pin number. */
  pinOn(comp: ComponentInfo, pinName: string): PortInfo | undefined {
    const byCanonical = comp.part ? pinNumberFor(comp.part, pinName) : undefined;
    if (byCanonical) {
      const p = comp.ports.find((p) => p.hints.includes(byCanonical));
      if (p) return p;
    }
    return comp.ports.find((p) => p.name === pinName) ?? comp.ports.find((p) => p.hints.includes(pinName));
  }

  /** Expand any pin reference to every port it matches. */
  resolvePins(ref: PinRef | string): Resolved<PortInfo[]> {
    if (ref.startsWith("header:")) {
      const label = ref.slice(7).toLowerCase();
      const found = this.componentsOfType("simple_pin_header").flatMap((c) =>
        c.ports.filter((p) => p.name.toLowerCase() === label || p.hints.some((h) => h.toLowerCase() === label)));
      return found.length ? { ok: true, value: found } : { ok: false, error: `no header pin labelled ${ref.slice(7)}` };
    }
    const dot = ref.lastIndexOf(".");
    if (dot <= 0) return { ok: false, error: `${ref} is not a pin reference (expected COMPONENT.PIN)` };
    const sel = ref.slice(0, dot);
    const pinName = ref.slice(dot + 1);
    const comps = this.resolveComponents(sel);
    if (!comps.ok) return { ok: false, error: `${ref}: ${comps.error}${sel.includes(":") ? "" : ` (have ${[...this.components.keys()].join(", ") || "none"})`}` };
    const ports: PortInfo[] = [];
    for (const c of comps.value) {
      const p = this.pinOn(c, pinName);
      if (!p) return { ok: false, error: `${ref}: pin ${pinName} not found on ${c.name} (pins: ${c.ports.map((p) => p.name).join(", ")})` };
      ports.push(p);
    }
    return { ok: true, value: ports };
  }

  /** Single-pin form of resolvePins; errors if the reference matches more than one pin. */
  resolvePin(ref: PinRef | string): Resolved<PortInfo> {
    const r = this.resolvePins(ref);
    if (!r.ok) return r;
    if (r.value.length > 1) return { ok: false, error: `${ref} matches ${r.value.length} pins (${r.value.map((p) => p.ref).join(", ")})` };
    return { ok: true, value: r.value[0] };
  }

  /** "VCC" (named net) or any pin reference -> connectivity key. All matched pins must share one net. */
  resolveNet(ref: NetRef): Resolved<string> {
    if (ref.includes(".") || ref.includes(":")) {
      const r = this.resolvePins(ref);
      if (!r.ok) return r;
      const loose = r.value.filter((p) => !p.net);
      if (loose.length) return { ok: false, error: `${ref}: ${loose.map((p) => p.ref).join(", ")} not connected to anything` };
      const keys = [...new Set(r.value.map((p) => p.net!))];
      if (keys.length > 1) return { ok: false, error: `${ref}: pins ${r.value.map((p) => p.ref).join(", ")} are on ${keys.length} different nets` };
      return { ok: true, value: keys[0] };
    }
    const key = this.namedNets.get(ref);
    if (!key) return { ok: false, error: `net ${ref} not found (named nets: ${[...this.namedNets.keys()].join(", ") || "none"})` };
    return { ok: true, value: key };
  }

  /** Ports on a net, grouped by component. */
  componentsOnNet(key: string): ComponentInfo[] {
    return [...this.components.values()].filter((c) => c.ports.some((p) => p.net === key));
  }

  /** The net on the other side of a two-terminal part, given one side. */
  otherSide(comp: ComponentInfo, key: string): string | undefined {
    const [a, b] = comp.ports;
    if (!a || !b) return undefined;
    return a.net === key ? b.net : b.net === key ? a.net : undefined;
  }

  /** Two-terminal parts of a type connected between two nets. */
  between(ftype: string, a: string, b: string): ComponentInfo[] {
    return this.componentsOfType(ftype).filter((c) => {
      const keys = c.ports.map((p) => p.net);
      return keys.length === 2 && keys.includes(a) && keys.includes(b) && a !== b;
    });
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
