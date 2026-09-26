import type { ExpectedChecks } from "../expected.ts"
// 5V header -> series resistor 820-1.5k -> red LED (anode toward 5V) -> GND.
export const expected: ExpectedChecks = {
  separate: [["J1.5V", "J1.GND"]],
  series_led: [{ label: "indicator LED", rail: "J1.5V", gnd: "J1.GND", min_ohms: 820, max_ohms: 1500, count: 1 }],
}
