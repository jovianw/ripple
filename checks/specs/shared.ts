// Building blocks shared by several specs' expected checks (see checks/requirements.md).
import type { BetweenRule, DecouplingRule, I2cBus, NetRef, RequiredNet, SeriesLedRule, TiedRule } from "../expected.ts"

/** USB-C as a power sink: VBUS and GND pins joined, CC1 and CC2 each pulled to GND with 5.1k. */
export function usbcSink(conn: string, vbusPins: `${string}.${string}`[], gndPins: `${string}.${string}`[]): { nets: RequiredNet[]; between: BetweenRule[] } {
  const nets: RequiredNet[] = [
    { name: "VBUS", pins: [`${conn}.VBUS1`, `${conn}.VBUS2`, ...vbusPins] },
    { name: "GND", pins: [`${conn}.GND1`, `${conn}.GND2`, ...gndPins] },
  ]
  const between: BetweenRule[] = [
    { label: "CC1 pull-down", kind: "resistor", a: `${conn}.CC1`, b: `${conn}.GND1`, min_ohms: 4700, max_ohms: 5600, count: 1 },
    { label: "CC2 pull-down", kind: "resistor", a: `${conn}.CC2`, b: `${conn}.GND1`, min_ohms: 4700, max_ohms: 5600, count: 1 },
  ]
  return { nets, between }
}

/** Linear regulator: >=1uF within 3mm on input and output, EN tied to VIN. */
export function ldo(chip: string, vin: string, vout: string, gnd: NetRef, en?: string): { decoupling: DecouplingRule[]; tied: TiedRule[] } {
  const decoupling: DecouplingRule[] = [
    { chip, power_pin: vin, ground: gnd, max_mm: 3, min_farads: 1e-6 },
    { chip, power_pin: vout, ground: gnd, max_mm: 3, min_farads: 1e-6 },
  ]
  return { decoupling, tied: en ? [{ pin: `${chip}.${en}`, to: [`${chip}.${vin}`] }] : [] }
}

/** Power LED with its own series resistor across rail and gnd. */
export function powerLed(label: string, rail: NetRef, gnd: NetRef): SeriesLedRule {
  return { label, rail, gnd, min_ohms: 220, max_ohms: 4700 }
}

/** I2C bus with 2.2k-10k pull-ups to vcc. */
export function i2cBus(sda: NetRef, scl: NetRef, vcc: NetRef): I2cBus {
  return { sda, scl, vcc, min_ohms: 2200, max_ohms: 10000 }
}

/** 100nF within 3mm of a chip's supply pin. */
export function decouple(chip: string, power_pin: string, ground: NetRef): DecouplingRule {
  return { chip, power_pin, ground, max_mm: 3, min_farads: 1e-7 }
}
