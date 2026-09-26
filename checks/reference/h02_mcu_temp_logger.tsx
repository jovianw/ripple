// Reference for h02_mcu_temp_logger: ATtiny85 reading an LM75 over its USI I2C pins, status LED on PB3.
import { part } from "./parts.ts"

export const H02Reference = () => (
  <board width="40mm" height="26mm">
    <pinheader name="J1" pinCount={2} pinLabels={["3V3", "GND"]} footprint="pinrow2" pcbX={-17} pcbY={0} pcbRotation={90} />
    <chip name="U1" {...part("mcu_attiny85")} pcbX={-7} pcbY={2} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={-4.5} pcbY={6} />
    <resistor name="R1" resistance="10k" footprint="0603" pcbX={-11} pcbY={-6} />
    <chip name="U2" {...part("temp_sensor_lm75")} pcbX={7} pcbY={2} />
    <capacitor name="C2" capacitance="100nF" footprint="0603" pcbX={9.5} pcbY={6} />
    <resistor name="R2" resistance="4.7k" footprint="0603" pcbX={-1} pcbY={-7} />
    <resistor name="R3" resistance="4.7k" footprint="0603" pcbX={4} pcbY={-7} />
    <resistor name="R4" resistance="1k" footprint="0603" pcbX={12} pcbY={-5} />
    <led name="LED1" color="red" footprint="0603" pcbX={16} pcbY={-5} />

    <trace from=".J1 > .pin1" to="net.V3V3" />
    <trace from=".J1 > .pin2" to="net.GND" />
    <trace from=".U1 > .VCC" to="net.V3V3" />
    <trace from=".U1 > .GND" to="net.GND" />
    <trace from=".C1 > .pin1" to="net.V3V3" />
    <trace from=".C1 > .pin2" to="net.GND" />
    <trace from=".R1 > .pin1" to="net.V3V3" />
    <trace from=".R1 > .pin2" to=".U1 > .PB5_RESET" />
    <trace from=".U1 > .PB0_MOSI_SDA" to="net.SDA" />
    <trace from=".U1 > .PB2_SCK_SCL" to="net.SCL" />
    <trace from=".U2 > .VCC" to="net.V3V3" />
    <trace from=".U2 > .GND" to="net.GND" />
    <trace from=".U2 > .SDA" to="net.SDA" />
    <trace from=".U2 > .SCL" to="net.SCL" />
    <trace from=".U2 > .A0" to="net.GND" />
    <trace from=".U2 > .A1" to="net.GND" />
    <trace from=".U2 > .A2" to="net.GND" />
    <trace from=".C2 > .pin1" to="net.V3V3" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.SDA" />
    <trace from=".R2 > .pin2" to="net.V3V3" />
    <trace from=".R3 > .pin1" to="net.SCL" />
    <trace from=".R3 > .pin2" to="net.V3V3" />
    <trace from=".U1 > .PB3" to=".R4 > .pin1" />
    <trace from=".R4 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to="net.GND" />
  </board>
)
