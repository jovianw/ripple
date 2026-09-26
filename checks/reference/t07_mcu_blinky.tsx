// Reference for t07_mcu_blinky: ATtiny85 with decoupling, reset pull-up, LED on PB3, ISP header.
import { part } from "./parts.ts"

export const T07Reference = () => (
  <board width="36mm" height="24mm">
    <pinheader name="J1" pinCount={2} pinLabels={["3V3", "GND"]} footprint="pinrow2" pcbX={-15} pcbY={0} pcbRotation={90} />
    <chip name="U1" {...part("mcu_attiny85")} pcbX={-4} pcbY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={-1.5} pcbY={4} />
    <resistor name="R1" resistance="10k" footprint="0603" pcbX={-9} pcbY={-6} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={4} pcbY={7} />
    <led name="LED1" color="red" footprint="0603" pcbX={9} pcbY={7} />
    <pinheader name="J2" pinCount={6} pinLabels={["MISO", "VCC", "SCK", "MOSI", "RESET", "GND"]} footprint="pinrow6" pcbX={14} pcbY={0} pcbRotation={90} />

    <trace from=".J1 > .pin1" to="net.V3V3" />
    <trace from=".J1 > .pin2" to="net.GND" />
    <trace from=".U1 > .VCC" to="net.V3V3" />
    <trace from=".U1 > .GND" to="net.GND" />
    <trace from=".C1 > .pin1" to="net.V3V3" />
    <trace from=".C1 > .pin2" to="net.GND" />
    <trace from=".R1 > .pin1" to="net.V3V3" />
    <trace from=".R1 > .pin2" to="net.RESET" />
    <trace from=".U1 > .PB5_RESET" to="net.RESET" />
    <trace from=".U1 > .PB3" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to="net.GND" />
    <trace from=".J2 > .pin1" to="net.MISO" />
    <trace from=".U1 > .PB1_MISO" to="net.MISO" />
    <trace from=".J2 > .pin2" to="net.V3V3" />
    <trace from=".J2 > .pin3" to="net.SCK" />
    <trace from=".U1 > .PB2_SCK_SCL" to="net.SCK" />
    <trace from=".J2 > .pin4" to="net.MOSI" />
    <trace from=".U1 > .PB0_MOSI_SDA" to="net.MOSI" />
    <trace from=".J2 > .pin5" to="net.RESET" />
    <trace from=".J2 > .pin6" to="net.GND" />
  </board>
)
