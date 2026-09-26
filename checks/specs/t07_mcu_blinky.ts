import type { ExpectedChecks } from "../expected.ts"
import { decouple } from "./shared.ts"
// ATtiny85: decoupling, reset pull-up, LED on a GPIO, ISP header on the programming pins.
export const expected: ExpectedChecks = {
  nets: [
    { name: "3V3", pins: ["J1.3V3", "U1.VCC", "J2.VCC"] },
    { name: "GND", pins: ["J1.GND", "U1.GND", "J2.GND"] },
    { name: "MISO", pins: ["J2.MISO", "U1.PB1_MISO"] },
    { name: "SCK", pins: ["J2.SCK", "U1.PB2_SCK_SCL"] },
    { name: "MOSI", pins: ["J2.MOSI", "U1.PB0_MOSI_SDA"] },
    { name: "RESET", pins: ["J2.RESET", "U1.PB5_RESET"] },
  ],
  separate: [["J1.3V3", "J1.GND"], ["U1.PB5_RESET", "J1.3V3"], ["U1.PB5_RESET", "J1.GND"]],
  decoupling: [decouple("U1", "VCC", "J1.GND")],
  between: [{ label: "reset pull-up", kind: "resistor", a: "U1.PB5_RESET", b: "J1.3V3", min_ohms: 1000, max_ohms: 100000 }],
  series_led: [{
    label: "status LED on a GPIO",
    rail: { any_pin_of: "U1", except: ["J1.3V3", "J1.GND", "U1.PB5_RESET"] },
    gnd: "J1.GND", min_ohms: 220, max_ohms: 4700,
  }],
}
