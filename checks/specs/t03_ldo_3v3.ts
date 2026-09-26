// t03: USB-C sink -> 3.3V LDO -> 3V3/GND header, power LED on 3V3.
import type { ExpectedChecks } from "../expected.ts"
import { ldo3v3, merge, powerLed, usbCSink } from "./common.ts"
export const expected: ExpectedChecks = merge(
  usbCSink("part:usb_c_receptacle.VBUS"),
  ldo3v3("part:usb_c_receptacle.VBUS"),
  powerLed("header:3V3"),
)
