// Fixture: examples/led-board.tsx re-exported, plus a variant with one trace dropped.
export { LedBoard } from "../../examples/led-board.tsx"

/** LED board with the R1 -> LED1 trace missing: the LED anode net never forms. */
export const LedBoardMissingTrace = () => (
  <board width="20mm" height="12mm">
    <pinheader name="J1" pinCount={2} pinLabels={["VCC", "GND"]} footprint="pinrow2" pcbX={-6} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} />
    <led name="LED1" color="red" footprint="0603" pcbX={5} />
    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".LED1 > .cathode" to=".J1 > .pin2" />
  </board>
)
