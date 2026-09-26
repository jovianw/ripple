// Reference for h04_dual_led_driver: power LED plus one LED per header pin, each with its own resistor.
// sharedResistor builds the wrong version (LED2 and LED3 behind one resistor) for the checker tests.
export const H04Reference = ({ sharedResistor = false }: { sharedResistor?: boolean } = {}) => (
  <board width="30mm" height="22mm">
    <pinheader name="J1" pinCount={4} pinLabels={["5V", "GND", "LED_A", "LED_B"]} footprint="pinrow4" pcbX={-11} pcbRotation={90} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-3} pcbY={7} />
    <led name="LED1" color="green" footprint="0603" pcbX={3} pcbY={7} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={-3} pcbY={0} />
    <led name="LED2" color="red" footprint="0603" pcbX={3} pcbY={0} />
    {!sharedResistor && <resistor name="R3" resistance="1k" footprint="0603" pcbX={-3} pcbY={-7} />}
    <led name="LED3" color="red" footprint="0603" pcbX={3} pcbY={-7} />

    <trace from=".J1 > .pin1" to="net.V5" />
    <trace from=".J1 > .pin2" to="net.GND" />
    <trace from=".J1 > .pin3" to="net.LED_A" />
    <trace from=".J1 > .pin4" to="net.LED_B" />
    <trace from=".R1 > .pin1" to="net.V5" />
    <trace from=".R1 > .pin2" to=".LED1 > .anode" />
    <trace from=".LED1 > .cathode" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.LED_A" />
    <trace from=".R2 > .pin2" to=".LED2 > .anode" />
    <trace from=".LED2 > .cathode" to="net.GND" />
    {sharedResistor ? (
      <trace from=".LED3 > .anode" to=".LED2 > .anode" />
    ) : (
      <trace from=".R3 > .pin1" to="net.LED_B" />
    )}
    {!sharedResistor && <trace from=".R3 > .pin2" to=".LED3 > .anode" />}
    {sharedResistor && <trace from="net.LED_B" to="net.LED_A" />}
    <trace from=".LED3 > .cathode" to="net.GND" />
  </board>
)
