// Registry of expected checks per spec id (specs/specs.json). One file per spec.
import type { ExpectedChecks } from "../expected.ts"
import { expected as ledBoard } from "./led-board.ts"
import { expected as t01 } from "./t01_led_indicator.ts"
import { expected as t02 } from "./t02_usbc_power_led.ts"
import { expected as t03 } from "./t03_ldo_3v3.ts"
import { expected as t04 } from "./t04_i2c_temp_breakout.ts"
import { expected as t05 } from "./t05_divider_12v_adc.ts"
import { expected as t06 } from "./t06_button_debounced.ts"
import { expected as t07 } from "./t07_mcu_blinky.ts"
import { expected as t08 } from "./t08_i2c_two_devices.ts"
import { expected as h01 } from "./h01_usbc_humidity_node.ts"
import { expected as h02 } from "./h02_mcu_temp_logger.ts"
import { expected as h03 } from "./h03_rc_lowpass.ts"
import { expected as h04 } from "./h04_dual_led_driver.ts"

const registry: Record<string, ExpectedChecks> = {
  "led-board": ledBoard,
  t01_led_indicator: t01,
  t02_usbc_power_led: t02,
  t03_ldo_3v3: t03,
  t04_i2c_temp_breakout: t04,
  t05_divider_12v_adc: t05,
  t06_button_debounced: t06,
  t07_mcu_blinky: t07,
  t08_i2c_two_devices: t08,
  h01_usbc_humidity_node: h01,
  h02_mcu_temp_logger: h02,
  h03_rc_lowpass: h03,
  h04_dual_led_driver: h04,
}

export function loadExpected(specId: string): ExpectedChecks {
  const e = registry[specId]
  if (!e) throw new Error(`no expected checks for spec "${specId}" (known: ${Object.keys(registry).join(", ")})`)
  return e
}

export const knownSpecIds = () => Object.keys(registry)
