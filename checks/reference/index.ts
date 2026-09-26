// Reference boards per spec id. Each proves its spec is solvable with whitelisted parts.
import { T01Reference } from "./t01_led_indicator.tsx"
import { T02Reference } from "./t02_usbc_power_led.tsx"
import { T03Reference } from "./t03_ldo_3v3.tsx"
import { T04Reference } from "./t04_i2c_temp_breakout.tsx"
import { T05Reference } from "./t05_divider_12v_adc.tsx"
import { T06Reference } from "./t06_button_debounced.tsx"
import { T07Reference } from "./t07_mcu_blinky.tsx"
import { T08Reference } from "./t08_i2c_two_devices.tsx"
import { H01Reference } from "./h01_usbc_humidity_node.tsx"
import { H02Reference } from "./h02_mcu_temp_logger.tsx"
import { H03Reference } from "./h03_rc_lowpass.tsx"
import { H04Reference } from "./h04_dual_led_driver.tsx"
import { FinaleReference } from "./finale.tsx"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const referenceBoards: Record<string, () => any> = {
  t01_led_indicator: T01Reference,
  t02_usbc_power_led: T02Reference,
  t03_ldo_3v3: T03Reference,
  t04_i2c_temp_breakout: T04Reference,
  t05_divider_12v_adc: T05Reference,
  t06_button_debounced: T06Reference,
  t07_mcu_blinky: T07Reference,
  t08_i2c_two_devices: T08Reference,
  h01_usbc_humidity_node: H01Reference,
  h02_mcu_temp_logger: H02Reference,
  h03_rc_lowpass: H03Reference,
  h04_dual_led_driver: H04Reference,
  finale: FinaleReference,
}
