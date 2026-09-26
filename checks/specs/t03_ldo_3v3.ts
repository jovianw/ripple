import type { ExpectedChecks } from "../expected.ts"
import { ldo, powerLed, usbcSink } from "./shared.ts"
// USB-C -> LDO -> 3.3V header, caps at the regulator, power LED on 3.3V.
const usb = usbcSink("J1", ["U1.VIN"], ["U1.GND", "J2.GND"])
const reg = ldo("U1", "VIN", "VOUT", "J2.GND", "EN")
export const expected: ExpectedChecks = {
  nets: [...usb.nets, { name: "3V3", pins: ["U1.VOUT", "J2.3V3"] }],
  between: usb.between,
  separate: [["J2.3V3", "J2.GND"], ["J2.3V3", "U1.VIN"]],
  decoupling: reg.decoupling,
  tied: reg.tied,
  series_led: [powerLed("power LED", "J2.3V3", "J2.GND")],
}
