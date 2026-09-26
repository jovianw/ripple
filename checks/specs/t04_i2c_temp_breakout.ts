import type { ExpectedChecks } from "../expected.ts"
import { decouple, i2cBus } from "./shared.ts"
// LM75 breakout: pull-ups, decoupling at VCC, address pins tied, header wired to matching nets.
export const expected: ExpectedChecks = {
  nets: [
    { name: "3V3", pins: ["J1.3V3", "U1.VCC"] },
    { name: "GND", pins: ["J1.GND", "U1.GND"] },
    { name: "SDA", pins: ["J1.SDA", "U1.SDA"] },
    { name: "SCL", pins: ["J1.SCL", "U1.SCL"] },
  ],
  separate: [["J1.3V3", "J1.GND"], ["J1.SDA", "J1.SCL"]],
  i2c: [i2cBus("J1.SDA", "J1.SCL", "J1.3V3")],
  decoupling: [decouple("U1", "VCC", "J1.GND")],
  tied: ["A0", "A1", "A2"].map((p) => ({ pin: `U1.${p}` as const, to: ["J1.GND", "J1.3V3"] })),
}
