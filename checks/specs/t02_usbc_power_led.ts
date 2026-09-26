// t02: USB-C sink to a 5V/GND header, green power LED.
import type { ExpectedChecks } from "../expected.ts"
import { merge, powerLed, usbCSink } from "./common.ts"
export const expected: ExpectedChecks = merge(usbCSink("header:5V"), powerLed("header:5V"))
