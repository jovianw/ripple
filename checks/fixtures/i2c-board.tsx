// Fixture: MCU (U1) talking I2C to a sensor (U2), with pull-ups and decoupling caps.
// Props let tests build deliberately broken variants without duplicating the board.
export interface I2cBoardProps {
  /** Omit the SCL pull-up resistor. */
  noSclPullup?: boolean
  /** Omit U1's decoupling cap. */
  noU1Cap?: boolean
  /** Place U1's decoupling cap far from U1 (mm). */
  u1CapOffsetMm?: number
  /** Short VCC to GND. */
  shortVccToGnd?: boolean
  /** Use this pull-up value instead of 4.7k. */
  pullupOhms?: string
}

export const I2cBoard = ({
  noSclPullup = false,
  noU1Cap = false,
  u1CapOffsetMm = 2,
  shortVccToGnd = false,
  pullupOhms = "4.7k",
}: I2cBoardProps = {}) => (
  <board width="34mm" height="24mm">
    <chip
      name="U1"
      footprint="soic8"
      pcbX={-9}
      pinLabels={{ pin1: "VCC", pin2: "SDA", pin3: "SCL", pin4: "GND", pin5: "IO1", pin6: "IO2", pin7: "IO3", pin8: "IO4" }}
    />
    <chip
      name="U2"
      footprint="soic8"
      pcbX={9}
      pinLabels={{ pin1: "VDD", pin2: "SDA", pin3: "SCL", pin4: "GND", pin5: "INT", pin6: "ADDR", pin7: "NC1", pin8: "NC2" }}
    />
    {!noU1Cap && <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={-9 - u1CapOffsetMm} pcbY={4} />}
    <capacitor name="C2" capacitance="100nF" footprint="0402" pcbX={9 - 2} pcbY={4} />
    <resistor name="R1" resistance={pullupOhms} footprint="0402" pcbX={0} pcbY={6} />
    {!noSclPullup && <resistor name="R2" resistance={pullupOhms} footprint="0402" pcbX={0} pcbY={-6} />}

    <trace from=".U1 > .VCC" to="net.VCC" />
    <trace from=".U1 > .GND" to="net.GND" />
    <trace from=".U2 > .VDD" to="net.VCC" />
    <trace from=".U2 > .GND" to="net.GND" />
    {!noU1Cap && <trace from=".C1 > .pin1" to="net.VCC" />}
    {!noU1Cap && <trace from=".C1 > .pin2" to="net.GND" />}
    <trace from=".C2 > .pin1" to="net.VCC" />
    <trace from=".C2 > .pin2" to="net.GND" />

    <trace from=".U1 > .SDA" to="net.SDA" />
    <trace from=".U2 > .SDA" to="net.SDA" />
    <trace from=".U1 > .SCL" to="net.SCL" />
    <trace from=".U2 > .SCL" to="net.SCL" />
    <trace from=".R1 > .pin1" to="net.SDA" />
    <trace from=".R1 > .pin2" to="net.VCC" />
    {!noSclPullup && <trace from=".R2 > .pin1" to="net.SCL" />}
    {!noSclPullup && <trace from=".R2 > .pin2" to="net.VCC" />}

    {shortVccToGnd && <trace from="net.VCC" to="net.GND" />}
  </board>
)
