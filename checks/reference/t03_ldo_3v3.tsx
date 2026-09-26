// Reference solution for t03_ldo_3v3. Proves the spec is buildable with whitelisted parts.
// Answers live in checks/, so runtime agents never see them.
import whitelist from "../../parts/whitelist.json" with { type: "json" }

const part = (id: string) => whitelist.parts.find((p) => p.id === id)!.props as any

export const T03Reference = () => (
  <board width="26mm" height="18mm">
    <chip name="J1" {...part("usb_c_receptacle")} pcbX={-8} pcbY={2} pcbRotation={-90} />
    <resistor name="R1" resistance="5.1k" footprint="0603" pcbX={-3} pcbY={5} />
    <resistor name="R2" resistance="5.1k" footprint="0603" pcbX={-3} pcbY={-5} />
    <chip name="U1" {...part("ldo_3v3_ap2112k")} pcbX={3} pcbY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={-0.2} pcbY={1.2} pcbRotation={90} />
    <capacitor name="C2" capacitance="1uF" footprint="0603" pcbX={6.2} pcbY={1.2} pcbRotation={90} />
    <led name="LED1" color="green" footprint="0603" pcbX={6} pcbY={5} />
    <resistor name="R3" resistance="1k" footprint="0603" pcbX={2} pcbY={5} />
    <pinheader name="J2" pinCount={2} pinLabels={["3V3", "GND"]} footprint="pinrow2" pcbX={10} pcbY={0} pcbRotation={90} />

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
    <trace from=".J2 > .pin1" to="net.V3V3" />
    <trace from=".J2 > .GND" to="net.GND" />
  </board>
)
