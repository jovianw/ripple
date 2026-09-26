import type { ExpectedChecks } from "../expected.ts"
// 12V -> divider -> ADC pin at 2.9-3.1V, total resistance >= 10k.
export const expected: ExpectedChecks = {
  nets: [{ name: "GND", pins: ["J1.GND", "J2.GND"] }],
  separate: [["J1.12V", "J2.ADC"], ["J2.ADC", "J1.GND"], ["J1.12V", "J1.GND"]],
  divider: [{ label: "ADC divider", top: "J1.12V", bottom: "J1.GND", out: "J2.ADC", vin: 12, vout_min: 2.9, vout_max: 3.1, min_total_ohms: 10000 }],
}
