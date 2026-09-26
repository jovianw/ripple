import type { ExpectedChecks } from "../expected.ts"
// Series R, C to GND, cutoff 0.8-1.25 kHz.
export const expected: ExpectedChecks = {
  nets: [{ name: "GND", pins: ["J1.GND", "J2.GND"] }],
  separate: [["J1.IN", "J2.OUT"], ["J2.OUT", "J1.GND"]],
  rc_lowpass: [{ label: "low-pass", in: "J1.IN", out: "J2.OUT", gnd: "J1.GND", min_cutoff_hz: 800, max_cutoff_hz: 1250 }],
}
