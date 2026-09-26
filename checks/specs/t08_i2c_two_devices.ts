import type { ExpectedChecks } from "../expected.ts"
import { decouple, i2cBus } from "./shared.ts"
// LM75 + 24LC256 on one bus: pull-ups, decoupling on both, address pins and WP tied, distinct addresses.
export const expected: ExpectedChecks = {
  nets: [
    { name: "3V3", pins: ["J1.3V3", "U1.VCC", "U2.VCC"] },
    { name: "GND", pins: ["J1.GND", "U1.GND", "U2.VSS"] },
    { name: "SDA", pins: ["J1.SDA", "U1.SDA", "U2.SDA"] },
    { name: "SCL", pins: ["J1.SCL", "U1.SCL", "U2.SCL"] },
  ],
  separate: [["J1.3V3", "J1.GND"], ["J1.SDA", "J1.SCL"]],
  i2c: [i2cBus("J1.SDA", "J1.SCL", "J1.3V3")],
  decoupling: [decouple("U1", "VCC", "J1.GND"), decouple("U2", "VCC", "J1.GND")],
  tied: [
    ...["A0", "A1", "A2"].map((p) => ({ pin: `U1.${p}` as const, to: ["J1.GND", "J1.3V3"] })),
    ...["A0", "A1", "A2", "WP"].map((p) => ({ pin: `U2.${p}` as const, to: ["J1.GND", "J1.3V3"] })),
  ],
  distinct_addresses: [{
    label: "I2C addresses", high: "J1.3V3", low: "J1.GND",
    devices: [
      { chip: "U1", base: 0x48, pins: ["A2", "A1", "A0"] },
      { chip: "U2", base: 0x50, pins: ["A2", "A1", "A0"] },
    ],
  }],
}
