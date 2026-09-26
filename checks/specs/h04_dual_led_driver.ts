// h04: power LED across 5V/GND, LED_A and LED_B each drive exactly one LED; no shared resistors.
import type { ExpectedChecks } from "../expected.ts"
export const expected: ExpectedChecks = {
  separate: [["header:LED_A", "header:LED_B"], ["header:5V", "header:GND"]],
  led_paths: [{ label: "power LED", from: "header:5V", to: "header:GND", count: 1 }],
  led_drivers: [
    { label: "LED_A", driver: "header:LED_A", count: 1 },
    { label: "LED_B", driver: "header:LED_B", count: 1 },
  ],
  leds: { min_count: 3 },
}
