# Hidden requirements per spec

What each spec in `specs/specs.json` is graded on. Runtime agents never see this file.
The checker engine turns these into typed `expected` definitions.

Every spec also gets the **base checks**: board renders, every trace routed, 0 DRC errors, no floating IC pins that need a defined level.

| Spec | Requirements |
|---|---|
| t01_led_indicator | LED in series with a resistor between 5V and GND; resistor 820Ω–1.5kΩ (≈3 mA with a ~2V red LED); LED anode toward 5V |
| t02_usbc_power_led | USB-C VBUS → 5V header pin, GND → GND pin; **CC1 and CC2 each pulled to GND with 5.1kΩ** (else no 5V from C-to-C chargers); power LED with series resistor |
| t03_ldo_3v3 | t02's USB-C rules; regulator input cap ≥1µF and output cap ≥1µF, each within 3mm of the regulator; 3.3V rail on header; power LED + resistor on 3.3V |
| t04_i2c_temp_breakout | **SDA and SCL each pulled up to 3V3 (2.2k–10kΩ)**; **100nF decoupling within 3mm of sensor VDD**; sensor address pins tied to a rail, not floating; header pins wired to the matching nets |
| t05_divider_12v_adc | Two resistors from 12V to GND, midpoint to output; SPICE: output 2.9–3.1V at 12V in; total divider resistance ≥10kΩ |
| t06_button_debounced | Pull-up 4.7k–47kΩ from BTN to 3V3 (direct, or through the series debounce resistor); button between signal and GND; RC debounce (series R + cap to GND, τ 1–20 ms); SPICE: high released, low pressed |
| t07_mcu_blinky | 100nF within 3mm of **every** MCU VDD pin; reset pulled up if the MCU has a reset pin; LED + resistor on a GPIO; programming header wired to the MCU's programming pins, VCC, and GND |
| t08_i2c_two_devices | t04's pull-up rule (at least one set, warn if more than one); decoupling on both devices; different I2C addresses; EEPROM WP tied to a rail |
| h01_usbc_humidity_node | t03's USB-C and regulator rules; t04's I2C rules for the humidity sensor; power LED |
| h02_mcu_temp_logger | t07's MCU rules; t04's I2C rules; sensor SDA/SCL wired to the MCU's hardware I2C pins |
| h03_rc_lowpass | Series R on the signal, cap from output to GND; SPICE: −3dB point 0.8–1.25 kHz |
| h04_dual_led_driver | Each LED has its own series resistor (no shared resistor); LED_A and LED_B each drive exactly one LED; power LED + resistor across 5V/GND |

The rules in bold are the most common first-board mistakes, so the demo's "fails a hidden check" moment should come from them.
