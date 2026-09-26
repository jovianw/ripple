// t01: 5V header lights a red LED at ~3 mA (1k with a ~2V red LED).
import type { ExpectedChecks } from "../expected.ts"
export const expected: ExpectedChecks = {
  separate: [["header:5V", "header:GND"]],
  led_paths: [{ label: "indicator LED", from: "header:5V", to: "header:GND", count: 1 }],
  leds: { min_count: 1, min_ohms: 820, max_ohms: 1500 },
}
