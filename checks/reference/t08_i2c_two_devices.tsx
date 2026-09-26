// Reference for t08_i2c_two_devices: LM75 (0x48) and 24LC256 (0x51) on one bus, one set of pull-ups.
import { part } from "./parts.ts"

export const T08Reference = () => (
  <board width="36mm" height="24mm">
    <pinheader name="J1" pinCount={4} pinLabels={["3V3", "GND", "SDA", "SCL"]} footprint="pinrow4" pcbX={-15} pcbRotation={90} />
    <chip name="U1" {...part("temp_sensor_lm75")} pcbX={-6} pcbY={3} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={-3.5} pcbY={7} />
    <chip name="U2" {...part("eeprom_24lc256")} pcbX={6} pcbY={3} />
    <capacitor name="C2" capacitance="100nF" footprint="0603" pcbX={8.5} pcbY={7} />
    <resistor name="R1" resistance="4.7k" footprint="0603" pcbX={-6} pcbY={-6} />
    <resistor name="R2" resistance="4.7k" footprint="0603" pcbX={6} pcbY={-6} />

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
    <trace from=".U2 > .VCC" to="net.V3V3" />
    <trace from=".U2 > .VSS" to="net.GND" />
    <trace from=".U2 > .SDA" to="net.SDA" />
    <trace from=".U2 > .SCL" to="net.SCL" />
    <trace from=".U2 > .A0" to="net.V3V3" />
    <trace from=".U2 > .A1" to="net.GND" />
    <trace from=".U2 > .A2" to="net.GND" />
    <trace from=".U2 > .WP" to="net.GND" />
    <trace from=".C2 > .pin1" to="net.V3V3" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".R1 > .pin1" to="net.SDA" />
    <trace from=".R1 > .pin2" to="net.V3V3" />
    <trace from=".R2 > .pin1" to="net.SCL" />
    <trace from=".R2 > .pin2" to="net.V3V3" />
  </board>
)
