// Reference for h03_rc_lowpass: 1.6k + 100nF gives a 995 Hz cutoff.
export const H03Reference = () => (
  <board width="24mm" height="16mm">
    <pinheader name="J1" pinCount={2} pinLabels={["IN", "GND"]} footprint="pinrow2" pcbX={-8} pcbRotation={90} />
    <resistor name="R1" resistance="1.6k" footprint="0603" pcbX={0} pcbY={3} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={4} pcbY={-2} pcbRotation={90} />
    <pinheader name="J2" pinCount={2} pinLabels={["OUT", "GND"]} footprint="pinrow2" pcbX={8} pcbRotation={90} />

    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.OUT" />
    <trace from=".C1 > .pin1" to="net.OUT" />
    <trace from=".C1 > .pin2" to="net.GND" />
    <trace from=".J1 > .pin2" to="net.GND" />
    <trace from=".J2 > .pin1" to="net.OUT" />
    <trace from=".J2 > .pin2" to="net.GND" />
  </board>
)
