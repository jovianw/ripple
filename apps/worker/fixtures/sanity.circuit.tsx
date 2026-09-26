// Green-check fixture: proves the pinned tscircuit compiles and autoroutes inside the repo.
export default () => (
  <board width="12mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-3} />
    <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={3} />
    <trace name="N1" from=".R1 > .pin1" to=".C1 > .pin1" />
    <trace name="N2" from=".R1 > .pin2" to=".C1 > .pin2" />
  </board>
)
