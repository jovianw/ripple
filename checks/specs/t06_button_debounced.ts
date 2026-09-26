// t06: BTN pulled up to 3V3 (4.7k-47k, directly or through a series debounce resistor),
// button to GND, RC debounce with tau 1-20 ms.
import type { ExpectedChecks } from "../expected.ts"
export const expected: ExpectedChecks = {
  separate: [["header:3V3", "header:GND"], ["header:BTN", "header:GND"], ["header:BTN", "header:3V3"]],
  resistors: [{ label: "BTN pull-up", a: "header:BTN", b: "header:3V3", min_ohms: 4700, max_ohms: 47000, series_ok: true }],
  switches: [{ label: "button", a: "header:BTN", b: "header:GND", via_resistor_ok: true }],
  rc: [{ label: "debounce", node: "header:BTN", ground: "header:GND", min_tau_s: 0.001, max_tau_s: 0.02 }],
}
