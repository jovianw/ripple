// Reference for t05_divider_12v_adc: 30k over 10k gives 3.0V from 12V; total 40k.
export const T05Reference = () => (
  <board width="24mm" height="16mm">
    <pinheader name="J1" pinCount={2} pinLabels={["12V", "GND"]} footprint="pinrow2" pcbX={-8} pcbRotation={90} />
    <resistor name="R1" resistance="30k" footprint="0603" pcbX={-2} pcbY={3} />
    <resistor name="R2" resistance="10k" footprint="0603" pcbX={2} pcbY={-3} />
    <pinheader name="J2" pinCount={2} pinLabels={["ADC", "GND"]} footprint="pinrow2" pcbX={8} pcbRotation={90} />

    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.ADC" />
    <trace from=".R2 > .pin1" to="net.ADC" />
    <trace from=".R2 > .pin2" to="net.GND" />
    <trace from=".J1 > .pin2" to="net.GND" />
    <trace from=".J2 > .pin1" to="net.ADC" />
    <trace from=".J2 > .pin2" to="net.GND" />
  </board>
)
