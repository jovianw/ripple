// Parts whitelist: tscircuit parts and footprints known to render, autoroute and pass DRC
// through the pinned tscircuit (0.0.2646). Referenced by HarnessConfig.tools.parts_whitelist.
// Every entry is rendered in parts-whitelist.test.ts; add a part only if that test passes.

export const PARTS_WHITELIST_VERSION = "v1";

export type PartKind =
  | "resistor"
  | "capacitor"
  | "led"
  | "diode"
  | "connector"
  | "regulator"
  | "mcu"
  | "sensor"
  | "switch"
  | "crystal";

/** tscircuit JSX element the part is written with. */
export type PartElement = "resistor" | "capacitor" | "led" | "diode" | "chip" | "pinheader" | "pushbutton" | "crystal";

export interface WhitelistedPart {
  /** Stable id, e.g. "res-0603". */
  id: string;
  kind: PartKind;
  element: PartElement;
  /** Exact tscircuit footprint string. */
  footprint: string;
  /** Props that are part of the definition (pin labels, pin count, load capacitance). */
  props?: Record<string, unknown>;
  /** Example values for the props the coder must still supply (resistance, capacitance...). */
  exampleProps?: Record<string, unknown>;
  /** One-line description for prompts. */
  description: string;
  /** Pin names in order, for chips. Matches props.pinLabels. */
  pins?: string[];
  notes?: string;
}

const chipPins = (labels: string[]): { pinLabels: Record<string, string> } => ({
  pinLabels: Object.fromEntries(labels.map((l, i) => [`pin${i + 1}`, l])),
});

export const partsWhitelist: WhitelistedPart[] = [
  // Passives
  { id: "res-0402", kind: "resistor", element: "resistor", footprint: "0402", exampleProps: { resistance: "10k" }, description: "Resistor, 0402" },
  { id: "res-0603", kind: "resistor", element: "resistor", footprint: "0603", exampleProps: { resistance: "10k" }, description: "Resistor, 0603 (default choice)" },
  { id: "res-0805", kind: "resistor", element: "resistor", footprint: "0805", exampleProps: { resistance: "10k" }, description: "Resistor, 0805" },
  { id: "cap-0402", kind: "capacitor", element: "capacitor", footprint: "0402", exampleProps: { capacitance: "100nF" }, description: "Ceramic capacitor, 0402" },
  { id: "cap-0603", kind: "capacitor", element: "capacitor", footprint: "0603", exampleProps: { capacitance: "100nF" }, description: "Ceramic capacitor, 0603 (default for decoupling)" },
  { id: "cap-0805", kind: "capacitor", element: "capacitor", footprint: "0805", exampleProps: { capacitance: "1uF" }, description: "Ceramic capacitor, 0805" },
  { id: "cap-1206", kind: "capacitor", element: "capacitor", footprint: "1206", exampleProps: { capacitance: "10uF" }, description: "Ceramic capacitor, 1206 (bulk)" },
  { id: "cap-elec-6.3mm", kind: "capacitor", element: "capacitor", footprint: "electrolytic_d6.3_p2.5", exampleProps: { capacitance: "100uF" }, description: "Electrolytic capacitor, 6.3mm radial, 2.5mm pitch" },

  // LEDs and diodes
  { id: "led-0603", kind: "led", element: "led", footprint: "0603", exampleProps: { color: "red" }, description: "LED, 0603 (pins: anode, cathode)" },
  { id: "led-0805", kind: "led", element: "led", footprint: "0805", exampleProps: { color: "green" }, description: "LED, 0805 (pins: anode, cathode)" },
  { id: "diode-sod123", kind: "diode", element: "diode", footprint: "sod123", description: "Schottky diode, SOD-123 (pins: anode, cathode), e.g. B5819W" },

  // Connectors
  { id: "header-1x2", kind: "connector", element: "pinheader", footprint: "pinrow2", props: { pinCount: 2 }, description: "Pin header 1x2, 2.54mm" },
  { id: "header-1x4", kind: "connector", element: "pinheader", footprint: "pinrow4", props: { pinCount: 4 }, description: "Pin header 1x4, 2.54mm" },
  { id: "header-1x6", kind: "connector", element: "pinheader", footprint: "pinrow6", props: { pinCount: 6 }, description: "Pin header 1x6, 2.54mm" },
  {
    id: "usbc-16p", kind: "connector", element: "chip", footprint: "usbcmidmount",
    props: chipPins(["GND1", "VBUS1", "SBU2", "CC1", "DN1", "DP1", "DN2", "DP2", "CC2", "SBU1", "VBUS2", "GND2", "SHIELD1", "SHIELD2", "SHIELD3", "SHIELD4"]),
    pins: ["GND1", "VBUS1", "SBU2", "CC1", "DN1", "DP1", "DN2", "DP2", "CC2", "SBU1", "VBUS2", "GND2", "SHIELD1", "SHIELD2", "SHIELD3", "SHIELD4"],
    description: "USB-C receptacle, 16-pin mid-mount (power + USB 2.0)",
    notes: "Tie GND1/GND2/SHIELD* to GND, VBUS1/VBUS2 to VBUS, 5.1k from each CC pin to GND for a sink. Pin order follows tscircuit's usbcmidmount numbering; verify against the physical part before fabrication.",
  },

  // Regulators
  {
    id: "reg-ldo-sot23-5", kind: "regulator", element: "chip", footprint: "sot23_5",
    props: chipPins(["VIN", "GND", "EN", "NC", "VOUT"]), pins: ["VIN", "GND", "EN", "NC", "VOUT"],
    description: "3.3V LDO, SOT-23-5 (AP2112K-3.3 pinout: VIN, GND, EN, NC, VOUT)",
    notes: "Tie EN to VIN. 1uF on VIN and VOUT.",
  },
  {
    id: "reg-ldo-sot223", kind: "regulator", element: "chip", footprint: "sot223",
    props: chipPins(["GND", "VOUT", "VIN", "TAB"]), pins: ["GND", "VOUT", "VIN", "TAB"],
    description: "3.3V LDO, SOT-223 (AMS1117-3.3 pinout: GND, VOUT, VIN, TAB=VOUT)",
    notes: "TAB is internally VOUT; connect it to VOUT. 10uF on VIN and VOUT.",
  },

  // Microcontroller
  {
    id: "mcu-stm32f030-tssop20", kind: "mcu", element: "chip", footprint: "tssop20",
    props: chipPins(["BOOT0", "PF0", "PF1", "NRST", "VDDA", "PA0", "PA1", "PA2", "PA3", "PA4", "PA5", "PA6", "PA7", "PB1", "VSS", "VDD", "PA9", "PA10", "SWDIO", "SWCLK"]),
    pins: ["BOOT0", "PF0", "PF1", "NRST", "VDDA", "PA0", "PA1", "PA2", "PA3", "PA4", "PA5", "PA6", "PA7", "PB1", "VSS", "VDD", "PA9", "PA10", "SWDIO", "SWCLK"],
    description: "STM32F030F4 microcontroller, TSSOP-20 (I2C1: PA9=SCL, PA10=SDA; UART1: PA2=TX, PA3=RX)",
    notes: "Power: VDD and VDDA to 3.3V, VSS to GND; 100nF decoupling at VDD. Pull BOOT0 to GND with 10k. Debug header: SWDIO, SWCLK, NRST, 3.3V, GND.",
  },

  // I2C sensors
  {
    id: "sensor-lm75-soic8", kind: "sensor", element: "chip", footprint: "soic8",
    props: chipPins(["SDA", "SCL", "OS", "GND", "A2", "A1", "A0", "VS"]), pins: ["SDA", "SCL", "OS", "GND", "A2", "A1", "A0", "VS"],
    description: "LM75 I2C temperature sensor, SOIC-8 (SDA, SCL, OS, GND, A2, A1, A0, VS)",
    notes: "VS is the supply pin (decouple it). Tie A0..A2 to GND for address 0x48.",
  },
  {
    id: "sensor-bme280-lga8", kind: "sensor", element: "chip", footprint: "lga8_w2.5_h2.5_p0.65",
    props: chipPins(["GND", "CSB", "SDI", "SCK", "SDO", "VDDIO", "GND2", "VDD"]), pins: ["GND", "CSB", "SDI", "SCK", "SDO", "VDDIO", "GND2", "VDD"],
    description: "BME280 I2C environmental sensor, LGA-8 (I2C mode: SDI=SDA, SCK=SCL, CSB to VDDIO, SDO selects address)",
    notes: "Tie CSB high for I2C. VDD and VDDIO to 3.3V with 100nF each.",
  },

  // Switches and timing
  { id: "button-tactile", kind: "switch", element: "pushbutton", footprint: "pushbutton", description: "Tactile pushbutton, 6mm, 4 pins (pin1/pin2 one side, pin3/pin4 the other)" },
  { id: "crystal-hc49", kind: "crystal", element: "crystal", footprint: "hc49", props: { loadCapacitance: "20pF" }, exampleProps: { frequency: "16MHz" }, description: "Crystal, HC-49 (pins: pin1, pin2); loadCapacitance is set by the whitelist" },
];

export function getPart(id: string): WhitelistedPart | undefined {
  return partsWhitelist.find((p) => p.id === id);
}

/** True when this element + footprint pair is on the whitelist. */
export function isWhitelisted(element: string, footprint: string): boolean {
  return partsWhitelist.some((p) => p.element === element && p.footprint === footprint);
}

function fmtProp(v: unknown): string {
  return typeof v === "string" ? `"${v}"` : `{${JSON.stringify(v)}}`;
}

/** tscircuit JSX for one part, e.g. <resistor name="R1" resistance="10k" footprint="0603" />. */
export function partExample(part: WhitelistedPart, name = "X1"): string {
  const props = { name, ...(part.exampleProps ?? {}), ...(part.props ?? {}), footprint: part.footprint };
  return `<${part.element} ${Object.entries(props).map(([k, v]) => `${k}=${fmtProp(v)}`).join(" ")} />`;
}

/** Markdown block for the coder prompt listing every allowed part with an example. */
export function partsWhitelistPrompt(): string {
  const lines = [`Allowed parts (whitelist ${PARTS_WHITELIST_VERSION}). Use only these elements and footprints:`];
  let kind: PartKind | undefined;
  for (const p of partsWhitelist) {
    if (p.kind !== kind) { kind = p.kind; lines.push("", `## ${kind}`); }
    lines.push(`- ${p.id}: ${p.description}`, `  ${partExample(p)}`);
    if (p.notes) lines.push(`  Note: ${p.notes}`);
  }
  return lines.join("\n");
}
