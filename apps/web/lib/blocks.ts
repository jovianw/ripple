// Split a board that failed into blocks that can be designed one at a time.
//
// A board built block by block (the planned path) already knows its blocks: each
// part carries its subcircuit. A board built in one pass does not, so blocks are
// read off the circuit instead: every chip, module, connector or LED anchors a
// block, and the passives wired to it join it. Failures are then pinned to the
// blocks whose parts they name, which is what says where to iterate next.

import type { PCBComponent, PCBState, PCBTrace } from "./types";

export interface CheckFailure {
  check: string;
  detail: string;
}

export interface PCBBlock {
  id: string;
  title: string;
  componentIds: string[];
  traceIds: string[];
  failing: boolean;
  failures: CheckFailure[];
  /** Centre and footprint of the block's parts, in board coordinates. */
  center: { x: number; y: number };
  size: { width: number; height: number };
  /** How far the block moves out from where it sat on the board. */
  offset: { x: number; y: number };
}

export interface BlockSplit {
  blocks: PCBBlock[];
  /** Failures that name no part (a DRC hit on a trace, a missing net). */
  unattributed: CheckFailure[];
}

const escape = (label: string) => label.toUpperCase().replace(/[^A-Z0-9_]/g, "");

/**
 * Which parts a checker failure is talking about. Failures are prose but name
 * designators ("TEMP_SENSOR VCC has no capacitor…"), so a word-boundary match
 * against the real labels is a sound join rather than a guess.
 */
export function componentsNamedIn(
  failures: CheckFailure[],
  components: PCBComponent[],
): Set<string> {
  const named = new Set<string>();
  for (const f of failures) {
    for (const id of namedBy(f, components)) named.add(id);
  }
  return named;
}

function namedBy(failure: CheckFailure, components: PCBComponent[]): string[] {
  const haystack = `${failure.check} ${failure.detail}`.toUpperCase();
  return components
    .filter((c) => {
      const label = escape(c.label);
      return label.length >= 2 && new RegExp(`\\b${label}\\b`).test(haystack);
    })
    .map((c) => c.id);
}

// Parts that support a chip rather than doing a job of their own.
const SUPPORT = /crystal|diode|transistor/i;
const isAnchor = (c: PCBComponent) =>
  c.type !== "resistor" &&
  c.type !== "capacitor" &&
  !SUPPORT.test(c.shortName ?? "");

// Type names too generic to add anything to a designator.
const GENERIC = /^(chip|ic|module)$/i;

const ACRONYM = /^(i2c|spi|usb|uart|mcu|led|ldo|adc|dac|pwm|gpio|rf|io)$/i;
const humanize = (key: string) =>
  key
    .split(/[_-]+/)
    .map((w, i) => (ACRONYM.test(w) ? w.toUpperCase() : i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

const dist2 = (a: PCBComponent, b: PCBComponent) =>
  (a.position.x - b.position.x) ** 2 + (a.position.y - b.position.y) ** 2;

/** Block key per component id. */
function assign(components: PCBComponent[]): Map<string, string> {
  const out = new Map<string, string>();
  const byId = new Map(components.map((c) => [c.id, c]));

  // Designed block by block: the subcircuit is the block.
  if (components.some((c) => c.group)) {
    const grouped = components.filter((c) => c.group);
    for (const c of grouped) out.set(c.id, c.group!);
    for (const c of components) {
      if (c.group) continue;
      const near = grouped.reduce((best, g) => (dist2(c, g) < dist2(c, best) ? g : best));
      out.set(c.id, near.group!);
    }
    return out;
  }

  const anchors = components.filter(isAnchor);
  if (anchors.length <= 1) {
    for (const c of components) out.set(c.id, "board");
    return out;
  }
  for (const a of anchors) out.set(a.id, a.id);

  // A support part joins the anchor it is wired to; failing that, one wired to
  // a part that is; failing that, the nearest anchor.
  const linkedAnchor = (c: PCBComponent, depth: number): string | undefined => {
    for (const id of c.links ?? []) {
      const other = byId.get(id);
      if (other && isAnchor(other)) return other.id;
    }
    if (depth === 0) return undefined;
    for (const id of c.links ?? []) {
      const other = byId.get(id);
      const found = other && !isAnchor(other) ? linkedAnchor(other, depth - 1) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  for (const c of components) {
    if (out.has(c.id)) continue;
    const anchor =
      linkedAnchor(c, 1) ??
      anchors.reduce((best, a) => (dist2(c, a) < dist2(c, best) ? a : best)).id;
    out.set(c.id, anchor);
  }
  return out;
}

/** The block a trace belongs to: the one owning the parts nearest both ends. */
function traceOwner(
  trace: PCBTrace,
  components: PCBComponent[],
  blockOf: Map<string, string>,
): string | null {
  const nearest = (p: { x: number; y: number }) => {
    let best: PCBComponent | null = null;
    let bestD = Infinity;
    for (const c of components) {
      const d = (c.position.x - p.x) ** 2 + (c.position.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? blockOf.get(best.id) : undefined;
  };
  const a = nearest(trace.points[0]);
  const b = nearest(trace.points[trace.points.length - 1]);
  return a && a === b ? a : null;
}

export function splitIntoBlocks(pcb: PCBState, failures: CheckFailure[]): BlockSplit {
  const { components } = pcb;
  if (components.length === 0) return { blocks: [], unattributed: failures };

  const blockOf = assign(components);
  const keys = [...new Set(components.map((c) => blockOf.get(c.id)!))];
  const byId = new Map(components.map((c) => [c.id, c]));

  const failuresBy = new Map<string, CheckFailure[]>();
  const unattributed: CheckFailure[] = [];
  for (const f of failures) {
    const owners = new Set(namedBy(f, components).map((id) => blockOf.get(id)!));
    if (owners.size === 0) unattributed.push(f);
    for (const k of owners) failuresBy.set(k, [...(failuresBy.get(k) ?? []), f]);
  }

  const traceIds = new Map<string, string[]>();
  for (const t of pcb.traces) {
    const owner = traceOwner(t, components, blockOf);
    if (owner) traceIds.set(owner, [...(traceIds.get(owner) ?? []), t.id]);
  }

  // Spread blocks out from the board centre along the line from the centre to
  // each block, far enough that the gaps read as seams.
  const spread = Math.max(1.4, 0.2 * Math.max(pcb.board.width, pcb.board.height));

  const blocks = keys.map((key, i): PCBBlock => {
    const parts = components.filter((c) => blockOf.get(c.id) === key);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of parts) {
      const w = (c.size?.width ?? 0.5) / 2;
      const h = (c.size?.height ?? 0.5) / 2;
      minX = Math.min(minX, c.position.x - w);
      maxX = Math.max(maxX, c.position.x + w);
      minY = Math.min(minY, c.position.y - h);
      maxY = Math.max(maxY, c.position.y + h);
    }
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const len = Math.hypot(center.x, center.y);
    const angle = (i / keys.length) * Math.PI * 2;
    const dir = len > 0.3 ? { x: center.x / len, y: center.y / len } : { x: Math.cos(angle), y: Math.sin(angle) };

    const anchor = byId.get(key);
    const title =
      key === "board"
        ? "Whole board"
        : anchor
          ? `${anchor.label}${anchor.shortName && !GENERIC.test(anchor.shortName) ? ` · ${anchor.shortName}` : ""}`
          : humanize(key);
    const blockFailures = failuresBy.get(key) ?? [];

    return {
      id: key,
      title,
      componentIds: parts.map((c) => c.id),
      traceIds: traceIds.get(key) ?? [],
      failing: blockFailures.length > 0 || parts.some((c) => c.status === "error"),
      failures: blockFailures,
      center,
      size: { width: maxX - minX, height: maxY - minY },
      offset: keys.length > 1 ? { x: dir.x * spread, y: dir.y * spread } : { x: 0, y: 0 },
    };
  });

  separate(blocks);

  // Failing blocks first: that is where the next iteration starts.
  blocks.sort((a, b) => Number(b.failing) - Number(a.failing));
  return { blocks, unattributed };
}

/** The same board again, carrying what the last attempt got wrong. */
export function retrySpec(wholeSpec: string, failures: CheckFailure[]): string {
  if (failures.length === 0) return wholeSpec;
  const failed = failures
    .slice(0, 4)
    .map((f) => (f.detail.length > 160 ? `${f.detail.slice(0, 157)}…` : f.detail))
    .join("; ");
  return `${wholeSpec} The last attempt failed: ${failed}. Avoid that.`;
}

/** Tile margin plus the gap left between tiles; matches the scene's tiles. */
const TILE_PAD = 0.45;
const GAP = 0.6;

/**
 * Blocks that sit in the same direction from the centre would slide on top of
 * each other, so push any overlapping pair apart along the axis where they
 * overlap least, until every tile has a clear gap around it.
 */
function separate(blocks: PCBBlock[]): void {
  const at = (b: PCBBlock) => ({ x: b.center.x + b.offset.x, y: b.center.y + b.offset.y });
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        const pa = at(a);
        const pb = at(b);
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const overlapX = (a.size.width + b.size.width) / 2 + TILE_PAD * 2 + GAP - Math.abs(dx);
        const overlapY = (a.size.height + b.size.height) / 2 + TILE_PAD * 2 + GAP - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapX < overlapY) {
          const push = (overlapX / 2) * (dx >= 0 ? 1 : -1);
          a.offset.x -= push;
          b.offset.x += push;
        } else {
          const push = (overlapY / 2) * (dy >= 0 ? 1 : -1);
          a.offset.y -= push;
          b.offset.y += push;
        }
      }
    }
    if (!moved) return;
  }
}

/** A spec for rebuilding one block on its own, carrying what it failed. */
export function blockSpec(
  block: PCBBlock,
  components: PCBComponent[],
  wholeSpec: string,
): string {
  const parts = components
    .filter((c) => block.componentIds.includes(c.id))
    .map((c) => (c.shortName ? `${c.label} (${c.shortName})` : c.label))
    .join(", ");
  const failed = block.failures
    .slice(0, 3)
    .map((f) => (f.detail.length > 160 ? `${f.detail.slice(0, 157)}…` : f.detail))
    .join("; ");
  return [
    `Build just one block of a larger board: ${block.title}, with ${parts}.`,
    failed ? `Last time it failed: ${failed}. Fix that.` : "",
    `The whole board, for context only: ${wholeSpec}`,
  ]
    .filter(Boolean)
    .join(" ");
}
