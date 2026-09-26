// t07: 3.3V MCU with decoupling, reset pull-up, status LED, and a wired ISP header.
import type { ExpectedChecks } from "../expected.ts"
import { mcu, merge } from "./common.ts"
export const expected: ExpectedChecks = merge(mcu("header:3V3"), {
  nets: [
    { name: "3V3", pins: ["header:VCC", "header:3V3"] },
    { name: "MISO", pins: ["header:MISO", "role:mcu.MISO"] },
    { name: "MOSI", pins: ["header:MOSI", "role:mcu.MOSI"] },
    { name: "SCK", pins: ["header:SCK", "role:mcu.SCK"] },
    { name: "RESET", pins: ["header:RESET", "role:mcu.RESET"] },
  ],
})
