// Expected checks for one spec. Each spec gets a file in checks/specs/<spec_id>.ts
// exporting an ExpectedChecks object. These files are hidden from the agents.
//
// References:
//   NetRef  "VCC"      a named net (<net name="VCC"/> or trace to="net.VCC")
//           "U1.VCC"   the net that pin VCC of component U1 sits on
//   PinRef  "U1.VCC"   component name, dot, pin name / label / number ("R1.pin1", "R1.1")

export type NetRef = string;
export type PinRef = `${string}.${string}`;

export interface RequiredNet {
  /** Label used in failure messages, e.g. "VCC" or "LED_ANODE". */
  name: string;
  /** All of these pins must be electrically connected to each other.
   *  If omitted, a named net called `name` must exist in the design. */
  pins?: PinRef[];
}

export interface I2cBus {
  sda: NetRef;
  scl: NetRef;
  /** Net the pull-ups go to. */
  vcc: NetRef;
  /** Optional resistance window in ohms. */
  min_ohms?: number;
  max_ohms?: number;
}

export interface DecouplingRule {
  /** Component name, e.g. "U1". */
  chip: string;
  /** Pin name on that chip, e.g. "VCC" or "VDD". */
  power_pin: string;
  /** Ground net; defaults to any net flagged is_ground, else any net other than the power net. */
  ground?: NetRef;
  /** Max distance in mm from the power pin's pad to the capacitor's pad on the same net. Default 3. */
  max_mm?: number;
  /** Optional minimum capacitance in farads (e.g. 1e-7 for 100nF). */
  min_farads?: number;
}

export interface ExpectedChecks {
  /** Connectivity: every required net exists. */
  nets?: RequiredNet[];
  /** Pairs of nets that must NOT be connected (shorts). */
  separate?: [NetRef, NetRef][];
  /** I2C pull-ups: each line has a resistor to VCC. */
  i2c?: I2cBus[];
  /** Decoupling: a capacitor near each chip's power pin. */
  decoupling?: DecouplingRule[];
  /** Routing and design rules. Always runs; max_errors defaults to 0. */
  drc?: { max_errors?: number };
}
