import type { ExpectedChecks } from "../expected.ts"
import { decouple, i2cBus } from "./shared.ts"
// t07's MCU rules, t04's I2C rules, sensor on the MCU's hardware I2C pins (USI: PB0=SDA, PB2=SCL).
export const expected: ExpectedChecks = {
  nets: [
    { name: "3V3", pins: ["J1.3V3", "U1.VCC", "U2.VCC"] },
    { name: "GND", pins: ["J1.GND", "U1.GND", "U2.GND"] },
    { name: "SDA", pins: ["U1.PB0_MOSI_SDA", "U2.SDA"] },
    { name: "SCL", pins: ["U1.PB2_SCK_SCL", "U2.SCL"] },
  ],
  separate: [["J1.3V3", "J1.GND"], ["U2.SDA", "U2.SCL"], ["U1.PB5_RESET", "J1.GND"]],
  decoupling: [decouple("U1", "VCC", "J1.GND"), decouple("U2", "VCC", "J1.GND")],
  between: [{ label: "reset pull-up", kind: "resistor", a: "U1.PB5_RESET", b: "J1.3V3", min_ohms: 1000, max_ohms: 100000 }],
  i2c: [i2cBus("U2.SDA", "U2.SCL", "J1.3V3")],
  tied: ["A0", "A1", "A2"].map((p) => ({ pin: `U2.${p}` as const, to: ["J1.GND", "J1.3V3"] })),
  series_led: [{
    label: "status LED on a GPIO",
    rail: { any_pin_of: "U1", except: ["J1.3V3", "J1.GND", "U1.PB5_RESET", "U2.SDA", "U2.SCL"] },
    gnd: "J1.GND", min_ohms: 220, max_ohms: 4700,
  }],
}
