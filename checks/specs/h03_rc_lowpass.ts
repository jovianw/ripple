// h03: RC low-pass IN -> OUT, cutoff 0.8-1.25 kHz (tau = 1/(2*pi*fc)).
import type { ExpectedChecks } from "../expected.ts"
export const expected: ExpectedChecks = {
  separate: [["header:IN", "header:OUT"]],
  rc: [{ label: "low-pass", node: "header:OUT", ground: "header:GND", r_from: "header:IN", min_tau_s: 1 / (2 * Math.PI * 1250), max_tau_s: 1 / (2 * Math.PI * 800) }],
}
