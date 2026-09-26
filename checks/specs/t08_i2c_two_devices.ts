// t08: temperature sensor + EEPROM sharing one I2C bus; both decoupled; EEPROM WP tied.
import type { ExpectedChecks } from "../expected.ts"
import { addressPins, i2c, merge, powered } from "./common.ts"
export const expected: ExpectedChecks = merge(
  powered("role:temp_sensor", "header:3V3"),
  powered("role:eeprom", "header:3V3"),
  i2c(["role:temp_sensor", "role:eeprom"], "header:SDA", "header:SCL", "header:3V3"),
  addressPins("role:temp_sensor", ["A0", "A1", "A2", "SDO", "CSB"]),
  addressPins("role:eeprom", ["A0", "A1", "A2", "WP"]),
)
