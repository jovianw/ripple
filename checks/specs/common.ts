// Shared rule blocks for spec files. Every reference is by header label or whitelist role,
// never by component name, so any correct board passes regardless of what the coder calls things.
import type { ExpectedChecks } from "../expected.ts"

const USB = "part:usb_c_receptacle"

/** Merge rule blocks into one ExpectedChecks. */
export function merge(...blocks: ExpectedChecks[]): ExpectedChecks {
  const out: Record<string, unknown[]> = {}
  let leds: ExpectedChecks["leds"]
  for (const b of blocks) {
    for (const [k, v] of Object.entries(b)) {
      if (k === "leds") { leds = { ...leds, ...(v as object) }; continue }
      if (k === "drc") continue
      out[k] = [...(out[k] ?? []), ...(v as unknown[])]
    }
  }
  return { ...(out as ExpectedChecks), ...(leds ? { leds } : {}) }
}

/** USB-C power sink: VBUS and GND tied together, 5.1k on each CC pin to ground. */
export const usbCSink = (vbus: string): ExpectedChecks => ({
  nets: [
    { name: "VBUS", pins: [`${USB}.VBUS`, `${USB}.VBUS2`, vbus] },
    { name: "GND", pins: [`${USB}.GND`, `${USB}.GND2`, "header:GND"] },
  ],
  resistors: [
    { label: "USB-C CC1 pull-down", a: `${USB}.CC1`, b: "header:GND", min_ohms: 4700, max_ohms: 5600 },
    { label: "USB-C CC2 pull-down", a: `${USB}.CC2`, b: "header:GND", min_ohms: 4700, max_ohms: 5600 },
  ],
  separate: [[`${USB}.CC1`, `${USB}.CC2`], [`${USB}.VBUS`, "header:GND"]],
})

/** 3.3V LDO from `vin` to header 3V3, with >=1uF caps within 3mm of VIN and VOUT. */
export const ldo3v3 = (vin: string): ExpectedChecks => ({
  nets: [
    { name: "LDO_IN", pins: ["role:ldo_3v3.VIN", vin] },
    { name: "3V3", pins: ["role:ldo_3v3.VOUT", "header:3V3"] },
    { name: "GND", pins: ["role:ldo_3v3.GND", "header:GND"] },
  ],
  tied: [{ label: "regulator enable", pin: "role:ldo_3v3.EN", one_of: [vin], optional: true }],
  decoupling: [
    { chip: "role:ldo_3v3", power_pin: "VIN", ground: "header:GND", max_mm: 3, min_farads: 1e-6 },
    { chip: "role:ldo_3v3", power_pin: "VOUT", ground: "header:GND", max_mm: 3, min_farads: 1e-6 },
  ],
})

/** Power LED with its own resistor from `rail` to GND. */
export const powerLed = (rail: string): ExpectedChecks => ({
  led_paths: [{ label: "power LED", from: rail, to: "header:GND" }],
  leds: { min_count: 1 },
})

/** Chip supply and ground on the rails, 100nF within 3mm of each supply pin. */
export const powered = (chip: string, rail: string): ExpectedChecks => ({
  nets: [
    { name: rail.replace("header:", ""), pins: [`${chip}.VCC`, rail] },
    { name: "GND", pins: [`${chip}.GND`, "header:GND"] },
  ],
  decoupling: [
    { chip, power_pin: "VCC", ground: "header:GND", max_mm: 3, min_farads: 1e-7 },
    { chip, power_pin: "VCC2", ground: "header:GND", max_mm: 3, min_farads: 1e-7, optional: true },
  ],
})

/** I2C bus: device SDA/SCL on the bus nets, one pull-up each (2.2k-10k) to `vcc`. */
export const i2c = (devices: string[], sda: string, scl: string, vcc: string): ExpectedChecks => ({
  nets: [
    { name: "SDA", pins: [...devices.map((d) => `${d}.SDA`), sda] },
    { name: "SCL", pins: [...devices.map((d) => `${d}.SCL`), scl] },
  ],
  separate: [[sda, scl]],
  i2c: [{ sda, scl, vcc, min_ohms: 2200, max_ohms: 10000 }],
})

/** Address pins tied to a rail, not floating. */
export const addressPins = (chip: string, pins: string[]): ExpectedChecks => ({
  tied: pins.map((p) => ({ label: `${chip} ${p}`, pin: `${chip}.${p}`, one_of: ["header:3V3", "header:GND"], optional: true })),
})

/** MCU basics: decoupled supply, reset pulled up (10k-100k), status LED on a GPIO. */
export const mcu = (rail: string): ExpectedChecks => merge(
  powered("role:mcu", rail),
  {
    resistors: [{ label: "MCU reset pull-up", a: "role:mcu.RESET", b: rail, min_ohms: 4700, max_ohms: 100000 }],
    led_drivers: [{ label: "status LED", driver: "role:mcu" }],
    leds: { min_count: 1 },
  },
)
