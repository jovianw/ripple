import type { ExpectedChecks } from "../expected.ts"
// Pull-up on the button node, button to GND, series R + C to GND on the output (tau 1-20 ms).
const buttonNode = { any_pin_of: "SW1", except: ["J1.GND"] }
export const expected: ExpectedChecks = {
  separate: [["J1.3V3", "J1.GND"], ["J1.BTN", "J1.GND"], ["J1.BTN", "J1.3V3"]],
  between: [
    { label: "button pull-up", kind: "resistor", a: buttonNode, b: "J1.3V3", min_ohms: 4700, max_ohms: 47000 },
    { label: "button to GND", kind: "pushbutton", a: buttonNode, b: "J1.GND" },
  ],
  rc_lowpass: [{ label: "debounce", in: buttonNode, out: "J1.BTN", gnd: "J1.GND", min_tau_s: 1e-3, max_tau_s: 20e-3 }],
}
