// Reference for t04_i2c_temp_breakout: LM75 on a 4-pin header with pull-ups, decoupling, address pins to GND.
import { part } from "./parts.ts"

export const T04Reference = () => (
  <board width="30mm" height="20mm">
    <pinheader name="J1" pinCount={4} pinLabels={["3V3", "GND", "SDA", "SCL"]} footprint="pinrow4" pcbX={-11} pcbRotation={90} />
    <chip name="U1" {...part("temp_sensor_lm75")} pcbX={2} pcbY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={4.5} pcbY={4} />
    <resistor name="R1" resistance="4.7k" footprint="0603" pcbX={-4} pcbY={6} />
    <resistor name="R2" resistance="4.7k" footprint="0603" pcbX={-4} pcbY={-6} />

    <trace from=".J1 > .pin1" to="net.V3V3" />
    <trace from=".J1 > .pin2" to="net.GND" />
    <trace from=".J1 > .pin3" to="net.SDA" />
    <trace from=".J1 > .pin4" to="net.SCL" />
    <trace from=".U1 > .VCC" to="net.V3V3" />
    <trace from=".U1 > .GND" to="net.GND" />
    <trace from=".U1 > .SDA" to="net.SDA" />
    <trace from=".U1 > .SCL" to="net.SCL" />
    <trace from=".U1 > .A0" to="net.GND" />
    <trace from=".U1 > .A1" to="net.GND" />
    <trace from=".U1 > .A2" to="net.GND" />
    <trace from=".C1 > .pin1" to="net.V3V3" />
    <trace from=".C1 > .pin2" to="net.GND" />
    <trace from=".R1 > .pin1" to="net.SDA" />
    <trace from=".R1 > .pin2" to="net.V3V3" />
    <trace from=".R2 > .pin1" to="net.SCL" />
    <trace from=".R2 > .pin2" to="net.V3V3" />
  </board>
)
