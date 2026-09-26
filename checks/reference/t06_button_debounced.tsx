// Reference for t06_button_debounced: BTN pulled up (10k), button to GND through 1k, 1uF on BTN (tau 10 ms).
// Released: BTN high. Pressed: BTN = 3.3V * 1k / 11k, low.
import { part } from "./parts.ts"

export const T06Reference = () => (
  <board width="30mm" height="20mm">
    <pinheader name="J1" pinCount={3} pinLabels={["3V3", "GND", "BTN"]} footprint="pinrow3" pcbX={-11} pcbRotation={90} />
    <resistor name="R1" resistance="10k" footprint="0603" pcbX={-4} pcbY={6} />
    <pushbutton name="SW1" {...part("pushbutton_smd")} pcbX={0} pcbY={-3} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={4} pcbY={6} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={9} pcbY={0} pcbRotation={90} />

    <trace from=".J1 > .pin1" to="net.V3V3" />
    <trace from=".J1 > .pin2" to="net.GND" />
    <trace from=".J1 > .pin3" to="net.BTN" />
    <trace from=".R1 > .pin1" to="net.V3V3" />
    <trace from=".R1 > .pin2" to="net.BTN" />
    <trace from=".SW1 > .pin1" to="net.SW" />
    <trace from=".SW1 > .pin3" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.SW" />
    <trace from=".R2 > .pin2" to="net.BTN" />
    <trace from=".C1 > .pin1" to="net.BTN" />
    <trace from=".C1 > .pin2" to="net.GND" />
  </board>
)
