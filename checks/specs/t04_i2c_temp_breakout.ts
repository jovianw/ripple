// t04: I2C temperature sensor breakout on a 3V3/GND/SDA/SCL header.
import type { ExpectedChecks } from "../expected.ts"
import { addressPins, i2c, merge, powered } from "./common.ts"
export const expected: ExpectedChecks = merge(
  powered("role:temp_sensor", "header:3V3"),
  i2c(["role:temp_sensor"], "header:SDA", "header:SCL", "header:3V3"),
  addressPins("role:temp_sensor", ["A0", "A1", "A2", "SDO", "CSB"]),
)
