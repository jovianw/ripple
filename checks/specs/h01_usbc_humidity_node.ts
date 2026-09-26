// h01: USB-C -> 3.3V LDO -> I2C humidity sensor, power LED, bus on a header.
import type { ExpectedChecks } from "../expected.ts"
import { addressPins, i2c, ldo3v3, merge, powerLed, powered, usbCSink } from "./common.ts"
export const expected: ExpectedChecks = merge(
  usbCSink("part:usb_c_receptacle.VBUS"),
  ldo3v3("part:usb_c_receptacle.VBUS"),
  powered("role:humidity_sensor", "header:3V3"),
  i2c(["role:humidity_sensor"], "header:SDA", "header:SCL", "header:3V3"),
  addressPins("role:humidity_sensor", ["SDO", "CSB"]),
  powerLed("header:3V3"),
)
