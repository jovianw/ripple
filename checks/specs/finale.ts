// Finale: USB-C -> 3.3V LDO -> MCU + temperature sensor + humidity sensor on one I2C bus,
// power LED, status LED, ISP header. The ISP header's VCC pin is the 3.3V rail.
import type { ExpectedChecks } from "../expected.ts"
import { addressPins, i2c, ldo3v3, mcu, merge, powerLed, powered, usbCSink } from "./common.ts"

const V33 = "header:VCC"

export const expected: ExpectedChecks = merge(
  usbCSink("part:usb_c_receptacle.VBUS"),
  ldo3v3("part:usb_c_receptacle.VBUS", V33),
  powerLed(V33),
  mcu(V33),
  powered("role:temp_sensor", V33),
  powered("role:humidity_sensor", V33),
  i2c(["role:temp_sensor", "role:humidity_sensor"], "role:mcu.SDA", "role:mcu.SCL", V33),
  addressPins("role:temp_sensor", ["A0", "A1", "A2", "SDO", "CSB"], V33),
  {
    nets: [
      { name: "MISO", pins: ["header:MISO", "role:mcu.MISO"] },
      { name: "MOSI", pins: ["header:MOSI", "role:mcu.MOSI"] },
      { name: "SCK", pins: ["header:SCK", "role:mcu.SCK"] },
      { name: "RESET", pins: ["header:RESET", "role:mcu.RESET"] },
    ],
    leds: { min_count: 2 },
  },
)
