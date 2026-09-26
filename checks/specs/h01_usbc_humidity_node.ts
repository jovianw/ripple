import type { ExpectedChecks } from "../expected.ts"
import { decouple, i2cBus, ldo, powerLed, usbcSink } from "./shared.ts"
// t03's USB-C and regulator rules, t04's I2C rules for the SHT40, power LED, bus header.
const usb = usbcSink("J1", ["U1.VIN"], ["U1.GND", "J2.GND", "U2.VSS"])
const reg = ldo("U1", "VIN", "VOUT", "J2.GND", "EN")
export const expected: ExpectedChecks = {
  nets: [
    ...usb.nets,
    { name: "3V3", pins: ["U1.VOUT", "J2.3V3", "U2.VDD"] },
    { name: "SDA", pins: ["J2.SDA", "U2.SDA"] },
    { name: "SCL", pins: ["J2.SCL", "U2.SCL"] },
  ],
  between: usb.between,
  separate: [["J2.3V3", "J2.GND"], ["J2.3V3", "U1.VIN"], ["J2.SDA", "J2.SCL"]],
  decoupling: [...reg.decoupling, decouple("U2", "VDD", "J2.GND")],
  tied: reg.tied,
  i2c: [i2cBus("J2.SDA", "J2.SCL", "J2.3V3")],
  series_led: [powerLed("power LED", "J2.3V3", "J2.GND")],
}
