// Expected checks for the LED smoke board (examples/led-board.tsx).
import type { ExpectedChecks } from "../expected.ts"

export const expected: ExpectedChecks = {
  nets: [
    { name: "VCC", pins: ["J1.VCC", "R1.pin1"] },
    { name: "LED_ANODE", pins: ["R1.pin2", "LED1.anode"] },
    { name: "GND", pins: ["LED1.cathode", "J1.GND"] },
  ],
  separate: [["J1.VCC", "J1.GND"]],
}
