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

/** Markdown block for the coder prompt listing every allowed part with an example. */
export function partsWhitelistPrompt(): string {
  const lines = [`Allowed parts (whitelist ${PARTS_WHITELIST_VERSION}). Use only these elements and footprints, with the props exactly as shown:`];
  let kind: string | undefined;
  for (const p of partsWhitelist) {
    if (p.kind !== kind) { kind = p.kind; lines.push("", `## ${kind}`); }
    lines.push(`- ${p.id}: ${p.description}`, `  ${partExample(p)}`);
    if (p.notes) lines.push(`  Note: ${p.notes}`);
  }
  return lines.join("\n");
}
