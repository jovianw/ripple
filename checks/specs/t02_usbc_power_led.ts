import type { ExpectedChecks } from "../expected.ts"
import { powerLed, usbcSink } from "./shared.ts"
// USB-C sink with CC pull-downs, 5V/GND header, power LED with series resistor.
const usb = usbcSink("J1", ["J2.5V"], ["J2.GND"])
export const expected: ExpectedChecks = {
  nets: usb.nets,
  between: usb.between,
  separate: [["J2.5V", "J2.GND"]],
  series_led: [powerLed("power LED", "J2.5V", "J2.GND")],
}
