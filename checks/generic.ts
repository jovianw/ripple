// Generic hidden checks for free-text specs, which have no per-spec file. Derived from what the board contains:
// each whitelisted part brings the rules that apply to its role (the same rules the per-spec files use), so a
// judge's own prompt is graded on real electronics, not just "it routed". Owner: Marcos.
//
//   genericExpected(circuitJson, specText?)
//     - every chip supply pin: 100nF (1uF for a regulator) within 3mm, supply not shorted to ground
//     - I2C: each bus's SDA and SCL pulled up (2.2k-10k) to the devices' supply
//     - every LED: its own series resistor
//     - address / write-protect / chip-select pins tied to a rail; regulator EN tied to VIN
//     - USB-C: CC1 and CC2 each pulled to GND with 4.7k-5.6k, not shared
//     - MCU: reset pulled up
//     - specText: every header label the prompt names, e.g. "(3V3, GND, SDA, SCL)", is on a connected pin
import type { AnyCircuitElement } from "circuit-json"
import type { ExpectedChecks } from "./expected.ts"
import { partForMpn, type WhitelistPart } from "./whitelist.ts"

type El = AnyCircuitElement & Record<string, any>

interface Placed { name: string; part: WhitelistPart; has: (canonical: string) => boolean }

const TIE_TO_RAIL = ["A0", "A1", "A2", "WP", "CSB", "SDO"]

/** Header labels named in free text, e.g. "a 4-pin header (3V3, GND, SDA, SCL)". */
export function headerLabels(text: string): string[] {
  return [...text.matchAll(/header\s*\(([^)]+)\)/gi)].flatMap((m) => m[1].split(",").map((s) => s.trim())).filter(Boolean)
}

export function genericExpected(circuitJson: AnyCircuitElement[] | unknown, specText?: string): ExpectedChecks {
  const json = (Array.isArray(circuitJson) ? circuitJson : []) as El[]
  const parts: Placed[] = json
    .filter((e) => e.type === "source_component")
    .map((c) => ({ name: c.name as string, part: partForMpn(c.manufacturer_part_number) }))
    .filter((c): c is { name: string; part: WhitelistPart } => !!c.part)
    .map(({ name, part }) => ({ name, part, has: (k: string) => !!part.canonicalPins?.[k] }))
  const role = (p: Placed, r: string) => !!p.part.roles?.includes(r)

  const e: Required<Pick<ExpectedChecks, "separate" | "i2c" | "decoupling" | "resistors" | "tied">> & ExpectedChecks = {
    separate: [], i2c: [], decoupling: [], resistors: [], tied: [],
  }

  for (const p of parts) {
    const gnd = p.has("GND") ? `${p.name}.GND` : undefined
    if (role(p, "ldo_3v3")) {
      for (const pin of ["VIN", "VOUT"]) e.decoupling.push({ chip: p.name, power_pin: pin, ground: gnd, max_mm: 3, min_farads: 1e-6 })
      if (p.has("EN")) e.tied.push({ label: `${p.name} enable`, pin: `${p.name}.EN`, one_of: [`${p.name}.VIN`] })
    } else if (p.has("VCC") && gnd) {
      e.decoupling.push({ chip: p.name, power_pin: "VCC", ground: gnd, max_mm: 3, min_farads: 1e-7 })
      if (p.has("VCC2")) e.decoupling.push({ chip: p.name, power_pin: "VCC2", ground: gnd, max_mm: 3, min_farads: 1e-7 })
      e.separate.push([`${p.name}.VCC`, gnd])
      for (const pin of TIE_TO_RAIL) {
        if (p.has(pin)) e.tied.push({ label: `${p.name} ${pin}`, pin: `${p.name}.${pin}`, one_of: [`${p.name}.VCC`, gnd] })
      }
    }
    if (role(p, "usb_c")) {
      for (const cc of ["CC1", "CC2"]) {
        e.resistors.push({ label: `USB-C ${cc} pull-down`, a: `${p.name}.${cc}`, b: `${p.name}.GND`, min_ohms: 4700, max_ohms: 5600 })
      }
      e.separate.push([`${p.name}.CC1`, `${p.name}.CC2`], [`${p.name}.VBUS`, `${p.name}.GND`])
    }
    if (role(p, "mcu") && p.has("RESET") && p.has("VCC")) {
      e.resistors.push({ label: `${p.name} reset pull-up`, a: `${p.name}.RESET`, b: `${p.name}.VCC`, min_ohms: 4700, max_ohms: 100000 })
    }
  }

  // I2C: one pull-up rule per bus. Devices on the same bus share the SDA net, so the first device stands for it;
  // the MCU (bus master) is preferred when there is one.
  const i2c = parts.filter((p) => p.has("SDA") && p.has("SCL") && p.has("VCC") && (role(p, "i2c_device") || role(p, "mcu")))
  const byBus = new Map<string, Placed>()
  const sdaNet = (p: Placed) => {
    const pin = p.part.canonicalPins!.SDA
    const port = json.find((x) => x.type === "source_port" && x.name === pin &&
      json.some((c) => c.type === "source_component" && c.name === p.name && c.source_component_id === x.source_component_id))
    return (port?.subcircuit_connectivity_map_key as string | undefined) ?? `unconnected:${p.name}`
  }
  // A bus exists only where an I2C device sits: an MCU alone (its SDA/SCL pins doubling as ISP pins) needs no pull-ups.
  const buses = new Set(i2c.filter((p) => role(p, "i2c_device")).map(sdaNet))
  for (const p of [...i2c].sort((a, b) => Number(role(b, "mcu")) - Number(role(a, "mcu")))) {
    const bus = sdaNet(p)
    if (buses.has(bus) && !byBus.has(bus)) byBus.set(bus, p)
  }
  for (const p of byBus.values()) {
    e.i2c.push({ sda: `${p.name}.SDA`, scl: `${p.name}.SCL`, vcc: `${p.name}.VCC`, min_ohms: 2200, max_ohms: 10000 })
    e.separate.push([`${p.name}.SDA`, `${p.name}.SCL`])
  }

  // Every LED gets its own series resistor (no value window: free text doesn't say the supply voltage).
  if (json.some((x) => x.type === "source_component" && x.ftype === "simple_led")) e.leds = {}

  // Header labels the prompt names must exist and be wired.
  const labels = specText ? headerLabels(specText) : []
  if (labels.length) e.nets = [...new Set(labels)].map((l) => ({ name: `header ${l}`, pins: [`header:${l}`] }))

  return e
}
