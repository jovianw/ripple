// Expected checks for one spec. Each spec gets a file in checks/specs/<spec_id>.ts
// exporting an ExpectedChecks object. These files are hidden from the agents.
//
// References:
//   PinRef  "U1.VCC"   component name, dot, pin name / label / number ("R1.pin1", "R1.1")
//   NetRef  "VCC"      a named net (<net name="VCC"/> or trace to="net.VCC")
//           "U1.VCC"   the net that pin VCC of component U1 sits on
//           { any_pin_of: "SW1", except: ["J1.GND"] }
//                      any net touching a pin of SW1, minus the listed nets. A rule with a
//                      wildcard side passes if any candidate net satisfies it.

export type PinRef = `${string}.${string}`;
export type NetRef = string | { any_pin_of: string; except?: string[] };

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

export type TwoTerminalKind = "resistor" | "capacitor" | "led" | "diode" | "pushbutton";

/** A two-terminal part bridging nets a and b. For led/diode, a is the anode side. */
export interface BetweenRule {
  label: string;
  kind: TwoTerminalKind;
  a: NetRef;
  b: NetRef;
  min_ohms?: number;
  max_ohms?: number;
  min_farads?: number;
  max_farads?: number;
  /** Exact number of matching parts. Default: at least one. */
  count?: number;
}

/** An LED with its own series resistor between rail (anode side) and gnd. */
export interface SeriesLedRule {
  label: string;
  rail: NetRef;
  gnd: NetRef;
  min_ohms?: number;
  max_ohms?: number;
  /** Exact number of LEDs driven from rail. Default: at least one. */
  count?: number;
}

/** A pin that must sit on one of the listed nets (not floating). */
export interface TiedRule {
  pin: PinRef;
  to: NetRef[];
}

/** Resistive divider top -> out -> bottom. DC output computed from resistor values. */
export interface DividerRule {
  label: string;
  top: NetRef;
  bottom: NetRef;
  out: NetRef;
  vin: number;
  vout_min: number;
  vout_max: number;
  min_total_ohms?: number;
}

/** Series R from in to out, C from out to gnd. tau = R*C, cutoff = 1 / (2*pi*tau). */
export interface RcLowpassRule {
  label: string;
  in: NetRef;
  out: NetRef;
  gnd: NetRef;
  min_tau_s?: number;
  max_tau_s?: number;
  min_cutoff_hz?: number;
  max_cutoff_hz?: number;
}

/** I2C devices whose address (base + address-pin bits) must all differ. Pins are MSB first. */
export interface DistinctAddressRule {
  label: string;
  high: NetRef;
  low: NetRef;
  devices: { chip: string; base: number; pins: string[] }[];
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
  /** Two-terminal parts that must bridge two nets (pull-ups, pull-downs, buttons...). */
  between?: BetweenRule[];
  /** LEDs with their own series resistor. */
  series_led?: SeriesLedRule[];
  /** Pins that must be tied to a rail. */
  tied?: TiedRule[];
  divider?: DividerRule[];
  rc_lowpass?: RcLowpassRule[];
  distinct_addresses?: DistinctAddressRule[];
  /** Routing and design rules. Always runs; max_errors defaults to 0. */
  drc?: { max_errors?: number };
}
