// Reference for t02_usbc_power_led: USB-C sink (CC pull-downs) -> 5V header, green power LED.
import { part } from "./parts.ts"

export const T02Reference = () => (
  <board width="30mm" height="20mm">
    <chip name="J1" {...part("usb_c_receptacle")} pcbX={-9} pcbY={2} pcbRotation={-90} />
    <resistor name="R1" resistance="5.1k" footprint="0603" pcbX={-3} pcbY={6} />
    <resistor name="R2" resistance="5.1k" footprint="0603" pcbX={-3} pcbY={-6} />
    <resistor name="R3" resistance="1k" footprint="0603" pcbX={3} pcbY={4} />
    <led name="LED1" color="green" footprint="0603" pcbX={8} pcbY={4} />
    <pinheader name="J2" pinCount={2} pinLabels={["5V", "GND"]} footprint="pinrow2" pcbX={10} pcbY={-3} pcbRotation={90} />

    <trace from=".J1 > .VBUS1" to="net.V5" />
    <trace from=".J1 > .VBUS2" to="net.V5" />
    <trace from=".J1 > .GND1" to="net.GND" />
    <trace from=".J1 > .GND2" to="net.GND" />
    <trace from=".J1 > .CC1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".J1 > .CC2" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to="net.GND" />

    <trace from=".R3 > .pin1" to="net.V5" />
    <trace from=".R3 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to="net.GND" />
    <trace from=".J2 > .pin1" to="net.V5" />
    <trace from=".J2 > .pin2" to="net.GND" />
  </board>
)
