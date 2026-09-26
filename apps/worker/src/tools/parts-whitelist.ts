// Parts whitelist: the coder may only use these parts. Source of truth is parts/whitelist.json
// (owner: Marcos), verified by `npm run verify:parts`. This module loads it and formats it for prompts.
import { readFileSync } from "node:fs"

export interface WhitelistedPart {
  /** Stable id, e.g. "resistor_0603". */
  id: string;
  kind: string;
  /** tscircuit JSX element the part is written with. */
  element: string;
  /** Props that define the part (footprint, pinLabels, pinAttributes, manufacturerPartNumber). */
  props: Record<string, unknown>;
  /** Example values for the props the coder still supplies (resistance, capacitance...). */
  exampleProps?: Record<string, unknown>;
  /** Functional roles, e.g. ["temp_sensor", "i2c_device"]. */
  roles?: string[];
  /** Canonical pin name -> this part's pin label, e.g. { VCC: "VDD" }. */
  canonicalPins?: Record<string, string>;
  description: string;
  notes?: string;
  /** Measured by `npm run verify:parts -- --write`: courtyard w x h and pad centres (by pin label), mm, at pcbRotation 0. */
  footprint?: Footprint;
}

export interface Footprint {
  courtyard: [number, number];
  pads: Record<string, [number, number]>;
}

interface WhitelistFile {
  version: string;
  parts: WhitelistedPart[];
}

// apps/worker/{src,dist}/tools -> repo root
const file = JSON.parse(readFileSync(new URL("../../../../parts/whitelist.json", import.meta.url), "utf8")) as WhitelistFile;

export const PARTS_WHITELIST_VERSION = file.version;
export const partsWhitelist: WhitelistedPart[] = file.parts;

export function getPart(id: string): WhitelistedPart | undefined {
  return partsWhitelist.find((p) => p.id === id);
}

/** True when this element + footprint pair is on the whitelist. */
export function isWhitelisted(element: string, footprint: string): boolean {
  return partsWhitelist.some((p) => p.element === element && p.props.footprint === footprint);
}

function fmtProp(v: unknown): string {
  return typeof v === "string" ? `"${v}"` : `{${JSON.stringify(v)}}`;
}

/** tscircuit JSX for one part, e.g. <resistor name="R1" resistance="10k" footprint="0603" />. */
export function partExample(part: WhitelistedPart, name = "X1"): string {
  const props = { name, ...(part.exampleProps ?? {}), ...part.props };
  return `<${part.element} ${Object.entries(props).map(([k, v]) => `${k}=${fmtProp(v)}`).join(" ")} />`;
}

/** One line with a courtyard and pad positions, e.g. "courtyard 2.96 x 1.46mm; pads pin1 (-0.82, 0), pin2 (0.83, 0)". */
export function footprintLine(footprint: Footprint): string {
  const [w, h] = footprint.courtyard;
  const pads = Object.entries(footprint.pads).map(([pin, [x, y]]) => `${pin} (${x}, ${y})`).join(", ");
  return `courtyard ${w} x ${h}mm; pads ${pads}`;
}

/**
 * How parts get placed, for the coder. A new board's parts are placed for it (tools/placement.ts): the coder's own
 * coordinates overlapped courtyards, which makes tscircuit skip autorouting. What the coder controls is the wiring,
 * and placement puts each small part next to what it is wired to.
 */
export const PLACEMENT_GUIDE = `## Placement
- New board: leave out pcbX/pcbY. Parts are placed for you after you write the code: tscircuit packs them, then
  each capacitor, resistor and LED is moved right beside the chip pin it is wired to.
- So wire every part to the pin it serves: a decoupling cap's supply side to that chip's VCC/VDD pin (one cap per
  supply pin; 1uF-and-up caps on a regulator's VIN/VOUT, 100nF on each chip's VCC/VDD), a pull-up to the bus pin,
  an LED's resistor to the GPIO pin that drives it. A part wired only to a header or a rail name has nothing to sit
  beside and ends up far from the pin, with long, crossing traces.
- Editing code whose parts already have pcbX/pcbY: keep every position. Move only a part a fix tells you to. Each
  whitelisted part lists its courtyard (w x h) and pad positions relative to its centre at pcbRotation 0;
  pcbRotation={90} turns it counter-clockwise (w and h swap, a pad at (x, y) moves to (-y, x)). Two parts'
  courtyards must not overlap: along the axis you separate them, centres at least half of each courtyard plus 0.3mm
  apart (a 0603 cap beside an 8-pin chip 5.8mm wide: 2.9 + 1.48 + 0.3 = 4.7mm from the chip's centre).`;

/** Markdown block for the coder prompt listing every allowed part with an example. */
export function partsWhitelistPrompt(): string {
  const lines = [`Allowed parts (whitelist ${PARTS_WHITELIST_VERSION}). Use only these elements and footprints, with the props exactly as shown:`];
  let kind: string | undefined;
  for (const p of partsWhitelist) {
    if (p.kind !== kind) { kind = p.kind; lines.push("", `## ${kind}`); }
    lines.push(`- ${p.id}: ${p.description}`, `  ${partExample(p)}`);
    if (p.footprint) lines.push(`  Footprint: ${footprintLine(p.footprint)}`);
    if (p.notes) lines.push(`  Note: ${p.notes}`);
  }
  return lines.join("\n");
}
