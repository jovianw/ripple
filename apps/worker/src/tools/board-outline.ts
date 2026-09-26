// Board outline for an edited board: the board wraps its parts. Owner: Jovian. Pure function on source text and
// Circuit JSON, like tools/normalize.ts and tools/placement.ts.
//
// In the critic's improve rounds the model decides where parts go; sizing the outline around them is arithmetic it
// gets wrong (boards so tight that header pads sit on the edge). So after an improve edit the harness pins every part
// where it rendered, centres the layout on the board origin, and sets <board width height> to the parts' outlines
// plus BOARD_MARGIN_MM: the board shrinks exactly as much as the parts were pulled together.
import { courtyards } from "./placement.js";

type El = { type: string; [k: string]: any };

/** Part outline (courtyard and pads, tools/placement.ts) to board edge, mm: clear of copper-to-edge rules. */
export const BOARD_MARGIN_MM = 1.5;

const round2 = (n: number) => Math.round(n * 100) / 100;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const POSITION = /\s+(?:pcbX|pcbY|pcbRotation)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g;

/** `source` with every part pinned where it rendered (re-centred) and a board sized to the parts plus the margin. */
export function fitBoardToParts(source: string, circuitJson: unknown): string {
  const els = (Array.isArray(circuitJson) ? circuitJson : []) as El[];
  const boxes = [...courtyards(els).values()];
  if (!boxes.length) throw new Error("fitBoardToParts: no part outlines in the render");
  const x0 = Math.min(...boxes.map((b) => b.x0)), x1 = Math.max(...boxes.map((b) => b.x1));
  const y0 = Math.min(...boxes.map((b) => b.y0)), y1 = Math.max(...boxes.map((b) => b.y1));
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  // Rounded up to 0.1mm so rounding never eats into the margin.
  const width = Math.ceil((x1 - x0 + 2 * BOARD_MARGIN_MM) * 10) / 10;
  const height = Math.ceil((y1 - y0 + 2 * BOARD_MARGIN_MM) * 10) / 10;

  const names = new Map(els.filter((e) => e.type === "source_component").map((c) => [c.source_component_id, c.name as string]));
  let out = source;
  for (const pc of els.filter((e) => e.type === "pcb_component" && e.center)) {
    const name = names.get(pc.source_component_id);
    if (!name) throw new Error(`fitBoardToParts: pcb_component ${pc.pcb_component_id} has no source component`);
    const tag = new RegExp(`<[A-Za-z]+\\b[^>]*?\\bname=["']${esc(name)}["'][^>]*>`);
    const current = out.match(tag)?.[0];
    if (!current) throw new Error(`fitBoardToParts: no element named ${name} in the source`);
    const rot = round2(pc.rotation ?? 0);
    const attrs = ` pcbX={${round2(pc.center.x - cx)}} pcbY={${round2(pc.center.y - cy)}}${rot ? ` pcbRotation={${rot}}` : ""}`;
    out = out.replace(current, current.replace(POSITION, "").replace(/(\bname=["'][^"']+["'])/, `$1${attrs}`));
  }
  const board = out.match(/<board\b[^>]*>/)?.[0];
  if (!board) throw new Error("fitBoardToParts: no <board> element in the source");
  const sized = board
    .replace(/\s+(?:width|height)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "")
    .replace(/^<board\b/, `<board width="${width}mm" height="${height}mm"`);
  return out.replace(board, sized);
}
