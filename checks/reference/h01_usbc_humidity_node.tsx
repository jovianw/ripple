// Reference for h01_usbc_humidity_node: USB-C -> AP2112K 3.3V -> SHT40 over I2C, power LED, bus header.
import { part } from "./parts.ts"

export const H01Reference = () => (
  <board width="40mm" height="30mm">
    <chip name="J1" {...part("usb_c_receptacle")} pcbX={-14} pcbY={4} pcbRotation={-90} />
    <resistor name="R1" resistance="5.1k" footprint="0603" pcbX={-8} pcbY={11} />
    <resistor name="R2" resistance="5.1k" footprint="0603" pcbX={-8} pcbY={-4} />
    <chip name="U1" {...part("ldo_3v3_ap2112k")} pcbX={-2} pcbY={4} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={-5.2} pcbY={5.2} pcbRotation={90} />
    <capacitor name="C2" capacitance="1uF" footprint="0603" pcbX={1.2} pcbY={5.2} pcbRotation={90} />
    <resistor name="R3" resistance="1k" footprint="0603" pcbX={-2} pcbY={11} />
    <led name="LED1" color="green" footprint="0603" pcbX={3} pcbY={11} />
    <chip name="U2" {...part("humidity_sensor_sht40")} pcbX={8} pcbY={-4} />
    <capacitor name="C3" capacitance="100nF" footprint="0603" pcbX={8} pcbY={-2} />
    <resistor name="R4" resistance="4.7k" footprint="0603" pcbX={6} pcbY={-9} />
    <resistor name="R5" resistance="4.7k" footprint="0603" pcbX={11} pcbY={-9} />
    <pinheader name="J2" pinCount={4} pinLabels={["3V3", "GND", "SDA", "SCL"]} footprint="pinrow4" pcbX={16} pcbY={2} pcbRotation={90} />

    <trace from=".J1 > .VBUS1" to="net.VBUS" />
    <trace from=".J1 > .VBUS2" to="net.VBUS" />
    <trace from=".J1 > .GND1" to="net.GND" />
    <trace from=".J1 > .GND2" to="net.GND" />
    <trace from=".J1 > .CC1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".J1 > .CC2" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to="net.GND" />

    <trace from=".U1 > .VIN" to="net.VBUS" />
    <trace from=".U1 > .EN" to="net.VBUS" />
    <trace from=".U1 > .GND" to="net.GND" />
    <trace from=".U1 > .VOUT" to="net.V3V3" />
    <trace from=".C1 > .pin1" to="net.VBUS" />
    <trace from=".C1 > .pin2" to="net.GND" />
    <trace from=".C2 > .pin1" to="net.V3V3" />
    <trace from=".C2 > .pin2" to="net.GND" />

    <trace from=".R3 > .pin1" to="net.V3V3" />
    <trace from=".R3 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to="net.GND" />

    <trace from=".U2 > .VDD" to="net.V3V3" />
    <trace from=".U2 > .VSS" to="net.GND" />
    <trace from=".U2 > .SDA" to="net.SDA" />
    <trace from=".U2 > .SCL" to="net.SCL" />
    <trace from=".C3 > .pin1" to="net.V3V3" />
    <trace from=".C3 > .pin2" to="net.GND" />
    <trace from=".R4 > .pin1" to="net.SDA" />
    <trace from=".R4 > .pin2" to="net.V3V3" />
    <trace from=".R5 > .pin1" to="net.SCL" />
    <trace from=".R5 > .pin2" to="net.V3V3" />

    <trace from=".J2 > .pin1" to="net.V3V3" />
    <trace from=".J2 > .pin2" to="net.GND" />
    <trace from=".J2 > .pin3" to="net.SDA" />
    <trace from=".J2 > .pin4" to="net.SCL" />
  </board>
)
