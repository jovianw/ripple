// Reference for the finale board: USB-C -> AP2112K 3.3V -> ATtiny85 reading an LM75 and an SHT40
// over I2C, power LED, status LED, 6-pin ISP header (its VCC pin is the 3.3V rail). 20 parts.
// Built as three groups, one per work-queue item: power, mcu, sensors. Groups connect by net name.
import { part } from "./parts.ts"

export const FinalePower = () => (
  <group name="power" pcbX={-15} pcbY={0}>
    <chip name="J1" {...part("usb_c_receptacle")} pcbX={-6} pcbY={2} pcbRotation={-90} />
    <resistor name="R1" resistance="5.1k" footprint="0603" pcbX={0} pcbY={9} />
    <resistor name="R2" resistance="5.1k" footprint="0603" pcbX={0} pcbY={-6} />
    <chip name="U1" {...part("ldo_3v3_ap2112k")} pcbX={6} pcbY={2} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={2.8} pcbY={3.2} pcbRotation={90} />
    <capacitor name="C2" capacitance="1uF" footprint="0603" pcbX={9.2} pcbY={3.2} pcbRotation={90} />
    <resistor name="R3" resistance="1k" footprint="0603" pcbX={5} pcbY={9} />
    <led name="LED1" color="green" footprint="0603" pcbX={9} pcbY={9} />

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
  </group>
)

export const FinaleMcu = () => (
  <group name="mcu" pcbX={4} pcbY={6}>
    <chip name="U2" {...part("mcu_attiny85")} pcbX={0} pcbY={0} />
    <capacitor name="C3" capacitance="100nF" footprint="0603" pcbX={2.5} pcbY={4} />
    <resistor name="R4" resistance="10k" footprint="0603" pcbX={-4} pcbY={5} />
    <resistor name="R5" resistance="1k" footprint="0603" pcbX={6} pcbY={6} />
    <led name="LED2" color="red" footprint="0603" pcbX={10} pcbY={6} />
    <pinheader name="J2" pinCount={6} pinLabels={["MISO", "VCC", "SCK", "MOSI", "RESET", "GND"]} footprint="pinrow6" pcbX={0} pcbY={10} />

    <trace from=".U2 > .VCC" to="net.V3V3" />
    <trace from=".U2 > .GND" to="net.GND" />
    <trace from=".C3 > .pin1" to="net.V3V3" />
    <trace from=".C3 > .pin2" to="net.GND" />
    <trace from=".R4 > .pin1" to="net.V3V3" />
    <trace from=".R4 > .pin2" to=".U2 > .PB5_RESET" />
    <trace from=".U2 > .PB0_MOSI_SDA" to="net.SDA" />
    <trace from=".U2 > .PB2_SCK_SCL" to="net.SCL" />
    <trace from=".U2 > .PB3" to=".R5 > .pin1" />
    <trace from=".R5 > .pin2" to=".LED2 > .anode" />
    <trace from=".LED2 > .cathode" to="net.GND" />
    <trace from=".J2 > .MISO" to=".U2 > .PB1_MISO" />
    <trace from=".J2 > .VCC" to="net.V3V3" />
    <trace from=".J2 > .SCK" to="net.SCL" />
    <trace from=".J2 > .MOSI" to="net.SDA" />
    <trace from=".J2 > .RESET" to=".U2 > .PB5_RESET" />
    <trace from=".J2 > .GND" to="net.GND" />
  </group>
)

export const FinaleSensors = () => (
  <group name="sensors" pcbX={6} pcbY={-9}>
    <chip name="U3" {...part("temp_sensor_lm75")} pcbX={-4} pcbY={0} />
    <capacitor name="C4" capacitance="100nF" footprint="0603" pcbX={-1} pcbY={4.2} />
    <chip name="U4" {...part("humidity_sensor_sht40")} pcbX={9} pcbY={0} />
    <capacitor name="C5" capacitance="100nF" footprint="0603" pcbX={11.8} pcbY={-0.4} pcbRotation={90} />
    <resistor name="R6" resistance="4.7k" footprint="0603" pcbX={3} pcbY={4} />
    <resistor name="R7" resistance="4.7k" footprint="0603" pcbX={3} pcbY={-4} />

    <trace from=".U3 > .VCC" to="net.V3V3" />
    <trace from=".U3 > .GND" to="net.GND" />
    <trace from=".U3 > .SDA" to="net.SDA" />
    <trace from=".U3 > .SCL" to="net.SCL" />
    <trace from=".U3 > .A0" to="net.GND" />
    <trace from=".U3 > .A1" to="net.GND" />
    <trace from=".U3 > .A2" to="net.GND" />
    <trace from=".C4 > .pin1" to="net.V3V3" />
    <trace from=".C4 > .pin2" to="net.GND" />
    <trace from=".U4 > .VDD" to="net.V3V3" />
    <trace from=".U4 > .VSS" to="net.GND" />
    <trace from=".U4 > .SDA" to="net.SDA" />
    <trace from=".U4 > .SCL" to="net.SCL" />
    <trace from=".C5 > .pin1" to="net.V3V3" />
    <trace from=".C5 > .pin2" to="net.GND" />
    <trace from=".R6 > .pin1" to="net.SDA" />
    <trace from=".R6 > .pin2" to="net.V3V3" />
    <trace from=".R7 > .pin1" to="net.SCL" />
    <trace from=".R7 > .pin2" to="net.V3V3" />
  </group>
)

export const FinaleReference = () => (
  <board width="50mm" height="36mm">
    <FinalePower />
    <FinaleMcu />
    <FinaleSensors />
  </board>
)
