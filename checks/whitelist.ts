// Loads parts/whitelist.json so checks can refer to parts by role ("any temp_sensor") and
// canonical pin ("VCC") instead of the names the coder happened to choose.
import { readFileSync } from "node:fs"

export interface WhitelistPart {
  id: string;
  element: string;
  props: { manufacturerPartNumber?: string; pinLabels?: Record<string, string>; [k: string]: unknown };
  roles?: string[];
  canonicalPins?: Record<string, string>;
}

const file = JSON.parse(readFileSync(new URL("../parts/whitelist.json", import.meta.url), "utf8")) as { parts: WhitelistPart[] };
export const whitelistParts = file.parts;

/** Whitelisted part for a component, matched by manufacturer part number. */
export function partForMpn(mpn: string | undefined): WhitelistPart | undefined {
  if (!mpn) return undefined;
  return whitelistParts.find((p) => p.props.manufacturerPartNumber === mpn);
}

/** "pin3" for a canonical pin, via canonicalPins -> pinLabels. */
export function pinNumberFor(part: WhitelistPart, canonical: string): string | undefined {
  const label = part.canonicalPins?.[canonical];
  if (!label) return undefined;
  return Object.entries(part.props.pinLabels ?? {}).find(([, l]) => l === label)?.[0];
}
