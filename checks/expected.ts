// Expected checks for one spec. Each spec gets a file in checks/specs/<spec_id>.ts
// exporting an ExpectedChecks object. These files are hidden from the agents.
//
// References. Prefer header: and role: forms in spec files: the coder picks its own
// component names, but header labels are fixed by the spec text and parts come from the whitelist.
//   PinRef  "header:SDA"             every pin-header pin labelled SDA
//           "role:temp_sensor.VCC"   canonical pin VCC on every whitelisted part with that role
//           "part:usb_c_receptacle.CC1"  canonical pin on every instance of a whitelisted part
//           "U1.VCC"                 component name, dot, pin name / label / number (tests only)
//   NetRef  any PinRef (all matched pins must share one net), or a named net "VCC"

export type NetRef = string;
export type PinRef = string;

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
  /** Component: "role:mcu", "part:ldo_3v3_ap2112k", or a name ("U1"). Applies to every match. */
  chip: string;
  /** Canonical pin (whitelisted parts) or pin name, e.g. "VCC". */
  power_pin: string;
  /** Skip parts that don't have this pin (e.g. VCC2 exists on only some sensors). */
  optional?: boolean;
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
  /** Resistors that must exist between two nets (pull-downs, pull-ups, series resistors). */
  resistors?: ResistorRule[];
  /** Pins that must be tied to one of the given nets (address pins, enables, write-protect). */
  tied?: TiedRule[];
  /** Every LED has its own series resistor; optional value window and count. */
  leds?: LedRule;
  /** LED + series resistor chains between two nets, anode toward `from`. */
  led_paths?: LedPathRule[];
  /** LED chains with one end driven by a pin of a component (e.g. an MCU GPIO). */
  led_drivers?: LedDriverRule[];
  /** Resistive dividers: output = input * ratio. */
  dividers?: DividerRule[];
  /** RC time constants (debounce, low-pass). */
  rc?: RcRule[];
  /** Pushbuttons switching between two nets. */
  switches?: SwitchRule[];
  /** Routing and design rules. Always runs; max_errors defaults to 0. */
  drc?: { max_errors?: number };
}

export interface ResistorRule {
  label: string;
  a: NetRef;
  b: NetRef;
  min_ohms?: number;
  max_ohms?: number;
}

export interface TiedRule {
  label: string;
  /** May match several pins (e.g. "role:eeprom.A0"); each must be tied. */
  pin: PinRef;
  one_of: NetRef[];
  /** Skip if no part on the board has this pin. */
  optional?: boolean;
}

export interface LedRule {
  min_count?: number;
  min_ohms?: number;
  max_ohms?: number;
}

export interface LedPathRule {
  label: string;
  from: NetRef;
  to: NetRef;
  /** Exact count if set, else at least 1. */
  count?: number;
}

export interface LedDriverRule {
  label: string;
  /** "role:mcu" or a net reference. */
  driver: string;
  /** Exact count if set, else at least 1. */
  count?: number;
}

export interface DividerRule {
  label: string;
  input: NetRef;
  output: NetRef;
  ground: NetRef;
  min_ratio: number;
  max_ratio: number;
  min_total_ohms?: number;
}

export interface RcRule {
  label: string;
  /** Node the capacitor charges. */
  node: NetRef;
  ground: NetRef;
  /** Far end of the resistor; omit to accept any resistor on the node (not to ground). */
  r_from?: NetRef;
  min_tau_s: number;
  max_tau_s: number;
}

export interface SwitchRule {
  label: string;
  a: NetRef;
  b: NetRef;
  /** Also accept one series resistor between the switch and `a`. */
  via_resistor_ok?: boolean;
}
