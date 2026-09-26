// Reference for t01_led_indicator: 5V header -> 1k -> red LED -> GND (about 3 mA).
export const T01Reference = () => (
  <board width="20mm" height="14mm">
    <pinheader name="J1" pinCount={2} pinLabels={["5V", "GND"]} footprint="pinrow2" pcbX={-6} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} />
    <led name="LED1" color="red" footprint="0603" pcbX={5} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to=".J1 > .pin2" />
  </board>
)
