// h02: MCU reads an I2C temperature sensor on its hardware I2C pins; status LED.
import type { ExpectedChecks } from "../expected.ts"
import { addressPins, i2c, mcu, merge, powered } from "./common.ts"
export const expected: ExpectedChecks = merge(
  mcu("header:3V3"),
  powered("role:temp_sensor", "header:3V3"),
  i2c(["role:temp_sensor"], "role:mcu.SDA", "role:mcu.SCL", "header:3V3"),
  addressPins("role:temp_sensor", ["A0", "A1", "A2", "SDO", "CSB"]),
)
