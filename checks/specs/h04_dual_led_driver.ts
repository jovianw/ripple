import type { ExpectedChecks } from "../expected.ts"
import { powerLed } from "./shared.ts"
// Power LED across 5V/GND; LED_A and LED_B each drive exactly one LED through its own resistor.
export const expected: ExpectedChecks = {
  separate: [["J1.5V", "J1.GND"], ["J1.LED_A", "J1.LED_B"], ["J1.LED_A", "J1.5V"], ["J1.LED_B", "J1.5V"]],
  series_led: [
    { ...powerLed("power LED", "J1.5V", "J1.GND"), count: 1 },
    { label: "LED_A", rail: "J1.LED_A", gnd: "J1.GND", min_ohms: 220, max_ohms: 4700, count: 1 },
    { label: "LED_B", rail: "J1.LED_B", gnd: "J1.GND", min_ohms: 220, max_ohms: 4700, count: 1 },
  ],
}
