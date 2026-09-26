// Board geometry from a render: courtyards, clear spots, and positions for parts the code left unplaced.
// Owner: Marcos. Pure functions on Circuit JSON and source text; no DB, no model (placeParts takes a render function).
//
// New boards (placeParts): the coder is bad at coordinates, and its own pcbX/pcbY overlap courtyards, which makes
// tscircuit skip autorouting. tscircuit's automatic placement never overlaps but doesn't know a decoupling cap
// belongs beside its chip's supply pin. So tscircuit packs the parts, then every small two-pin part is moved beside
// the pad it's wired to.
//
// Repairs pin every existing part (bakePlacement), so fixing one part doesn't re-pack the rest. Parts a repair adds
// or moves are placed by the model's guess (or not at all, and tscircuit doesn't fit them around pinned parts), and
// land on top of others. settlePlacement moves just those to the nearest clear spot.

import { bakePlacement, withoutPlacement } from "./normalize.js"

type El = { type: string; [k: string]: any }
export type Box = { x0: number; x1: number; y0: number; y1: number }
/** A part's outline relative to its centre, at one rotation. */
export type Shape = { rotation: number; rel: Box }
export type Spot = { x: number; y: number; rotation: number; d: number }

export const CLEARANCE = 0.15
// Pads count as part of the outline, with this much copper keep-out around them.
const PAD_MARGIN = 0.25
export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/**
 * Outline of each pcb component, by pcb_component_id: its courtyard (or body) united with its pads. The pads are
 * always where the part really is; tscircuit's courtyard for a rotated part can keep the unrotated orientation.
 */
export function courtyards(els: El[]): Map<string, Box> {
  const out = new Map<string, Box>()
  const grow = (id: string | undefined, x0: number, x1: number, y0: number, y1: number) => {
    if (!id || ![x0, x1, y0, y1].every(Number.isFinite)) return
    const b = out.get(id)
    out.set(id, b ? { x0: Math.min(b.x0, x0), x1: Math.max(b.x1, x1), y0: Math.min(b.y0, y0), y1: Math.max(b.y1, y1) } : { x0, x1, y0, y1 })
  }
  // A courtyard as reported, and turned a quarter about the part's centre when the part is rotated 90/270: which
  // of the two tscircuit's own overlap check uses varies, so both count as occupied.
  const comp = new Map(els.filter((e) => e.type === "pcb_component").map((e) => [e.pcb_component_id, e]))
  const courtyard = (id: string, x0: number, x1: number, y0: number, y1: number) => {
    grow(id, x0, x1, y0, y1)
    const pc = comp.get(id)
    if (!pc || Math.round((((pc.rotation ?? 0) % 180) + 180) % 180) !== 90) return
    const { x: cx, y: cy } = pc.center
    grow(id, cx - (y1 - cy), cx + (cy - y0), cy - (x1 - cx), cy + (cx - x0))
  }
  const around = (e: El, w: number, h: number) =>
    grow(e.pcb_component_id, e.x - w / 2 - PAD_MARGIN, e.x + w / 2 + PAD_MARGIN, e.y - h / 2 - PAD_MARGIN, e.y + h / 2 + PAD_MARGIN)
  for (const e of els) {
    if (e.type === "pcb_courtyard_rect")
      courtyard(e.pcb_component_id, e.center.x - e.width / 2, e.center.x + e.width / 2, e.center.y - e.height / 2, e.center.y + e.height / 2)
    if (e.type === "pcb_courtyard_outline" && e.outline?.length) {
      const xs = e.outline.map((p: { x: number }) => p.x), ys = e.outline.map((p: { y: number }) => p.y)
      courtyard(e.pcb_component_id, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys))
    }
    // A pad's width/height may be in its unrotated frame: take the larger side both ways.
    if (e.type === "pcb_smtpad") {
      const side = e.shape === "circle" ? 2 * e.radius : Math.max(e.width ?? 0, e.height ?? 0)
      around(e, side, side)
    }
    if (e.type === "pcb_plated_hole") {
      const side = e.outer_diameter ?? Math.max(e.outer_width ?? 0, e.outer_height ?? 0, e.rect_pad_width ?? 0, e.rect_pad_height ?? 0)
      around(e, side, side)
    }
  }
  for (const e of els) {
    if (e.type === "pcb_component" && !out.has(e.pcb_component_id))
      grow(e.pcb_component_id, e.center.x - e.width / 2, e.center.x + e.width / 2, e.center.y - e.height / 2, e.center.y + e.height / 2)
  }
  return out
}

/** The two orientations of a w x h outline (a part being added, where we choose the rotation). */
export const bothWays = (size: { w: number; h: number }): Shape[] => [
  { rotation: 0, rel: { x0: -size.w / 2, x1: size.w / 2, y0: -size.h / 2, y1: size.h / 2 } },
  { rotation: 90, rel: { x0: -size.h / 2, x1: size.h / 2, y0: -size.w / 2, y1: size.w / 2 } },
]

/** A shape's outline at a spot, padded by CLEARANCE. */
export const spotBox = (s: { x: number; y: number }, rel: Box): Box => ({
  x0: s.x + rel.x0 - CLEARANCE, x1: s.x + rel.x1 + CLEARANCE, y0: s.y + rel.y0 - CLEARANCE, y1: s.y + rel.y1 + CLEARANCE,
})

/**
 * The nearest centre to `target` for any of `shapes` whose padded outline stays clear of every obstacle. Grid
 * search out to `radius` mm; on a tie the earlier shape wins.
 */
export function clearSpot(target: { x: number; y: number }, shapes: Shape[], obstacles: Box[], radius = 5, step = 0.05): (Spot & { rel: Box }) | undefined {
  let best: (Spot & { rel: Box }) | undefined
  const n = Math.round(radius / step)
  for (const { rotation, rel } of shapes) {
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const x = target.x + i * step
        const y = target.y + j * step
        const d = Math.hypot(x - target.x, y - target.y)
        if (best && d >= best.d) continue
        if (obstacles.some((o) => overlaps(spotBox({ x, y }, rel), o))) continue
        best = { x, y, rotation, d, rel }
      }
    }
  }
  return best
}

const r2 = (v: number) => Math.round(v * 100) / 100
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const tagOf = (source: string, name: string) =>
  source.match(new RegExp(`<[A-Za-z]+\\b[^>]*?\\bname=["']${esc(name)}["'][^>]*>`))?.[0]
const attr = (tag: string | undefined, key: string) => tag?.match(new RegExp(`\\b${key}=\\{\\s*(-?[\\d.]+)\\s*\\}`))?.[1]

/**
 * After a repair, keeps the parts it didn't touch where they were and makes every part it added or moved fit:
 * each keeps its intended position when that's clear, else takes the nearest clear spot (for a part with no
 * position at all, the spot nearest the pinned pads it's wired to). Positions come from `circuitJson`, a render of
 * `source`. Returns `source` unchanged when nothing needs to move.
 */
export function settlePlacement(source: string, circuitJson: unknown, previous: string): string {
  if (!Array.isArray(circuitJson)) return source
  const els = circuitJson as El[]
  const nameOf = new Map(els.filter((e) => e.type === "source_component").map((e) => [e.source_component_id, e.name as string]))
  const parts = els
    .filter((e) => e.type === "pcb_component" && nameOf.has(e.source_component_id))
    .map((pc) => ({ pc, name: nameOf.get(pc.source_component_id)!, tag: tagOf(source, nameOf.get(pc.source_component_id)!) }))
    .filter((p): p is typeof p & { tag: string } => !!p.tag)
  // Untouched: same pcbX/pcbY as in the code the repair started from. Everything else is the repair's to fit.
  const untouched = (p: (typeof parts)[number]) => {
    const was = tagOf(previous, p.name)
    return !!attr(p.tag, "pcbX") && attr(p.tag, "pcbX") === attr(was, "pcbX") && attr(p.tag, "pcbY") === attr(was, "pcbY")
  }
  const boxes = courtyards(els)
  const area = (b?: Box) => (b ? (b.x1 - b.x0) * (b.y1 - b.y0) : 0)
  const fixed = parts.filter(untouched)
  // Untouched parts that already overlap (the previous attempt's layout had them on top of each other): the
  // smaller of each pair moves too.
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = boxes.get(fixed[i].pc.pcb_component_id), b = boxes.get(fixed[j].pc.pcb_component_id)
      if (!a || !b || !overlaps(a, b)) continue
      fixed.splice(area(a) < area(b) ? i : j, 1)
      i = -1
      break
    }
  }
  const movable = parts.filter((p) => !fixed.includes(p))
  if (!movable.length || !fixed.length) return source

  // Pad position of ".PART > .PIN" from the render: by pin label, pinN, or port hint.
  const ports = els.filter((e) => e.type === "source_port")
  const pcbPort = new Map(els.filter((e) => e.type === "pcb_port").map((p) => [p.source_port_id, p]))
  const scId = new Map([...nameOf].map(([id, name]) => [name, id]))
  const padOf = (part: string, pin: string) => {
    const sp = ports.find((p) => p.source_component_id === scId.get(part) && (p.name === pin || `pin${p.pin_number}` === pin || p.port_hints?.includes(pin)))
    const pp = sp && pcbPort.get(sp.source_port_id)
    return pp ? { x: pp.x as number, y: pp.y as number } : undefined
  }
  const traces = [...source.matchAll(/<trace\b[^>]*?\bfrom=["']\.([\w-]+)\s*>\s*\.([\w-]+)["'][^>]*?\bto=["']\.([\w-]+)\s*>\s*\.([\w-]+)["'][^>]*>/g)]
    .map((m) => [{ part: m[1], pin: m[2] }, { part: m[3], pin: m[4] }] as const)

  const fixedNames = new Set(fixed.map((p) => p.name))
  const obstacles: Box[] = fixed.map((p) => boxes.get(p.pc.pcb_component_id)).filter((b): b is Box => !!b)
  const centroid = (pts: { x: number; y: number }[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length })

  // Parts the code positioned go first (their intended spot is known); unpositioned ones fill in around them.
  // Each keeps its rotation and moves only as far as it must.
  let out = source
  for (const p of [...movable.filter((m) => attr(m.tag, "pcbX")), ...movable.filter((m) => !attr(m.tag, "pcbX"))]) {
    const b = boxes.get(p.pc.pcb_component_id)
    if (!b) continue
    const c = p.pc.center as { x: number; y: number }
    const rel = { x0: b.x0 - c.x, x1: b.x1 - c.x, y0: b.y0 - c.y, y1: b.y1 - c.y }
    const positioned = !!attr(p.tag, "pcbX")
    const pads = traces
      .flatMap(([a, e]) => (a.part === p.name ? [e] : e.part === p.name ? [a] : []))
      .filter((end) => fixedNames.has(end.part))
      .map((end) => padOf(end.part, end.pin))
      .filter((q): q is { x: number; y: number } => !!q)
    const target = positioned ? c : pads.length ? centroid(pads) : centroid(fixed.map((f) => f.pc.center))
    const spot = clearSpot(target, [{ rotation: 0, rel }], obstacles, 12, 0.05)
    if (!spot) continue
    obstacles.push(spotBox(spot, rel))
    if (positioned && spot.d < 0.01) continue // already clear where the repair put it
    // The render's centre can differ slightly from the code's pcbX/pcbY; shift the code's values by the same move.
    const dx = spot.x - c.x, dy = spot.y - c.y
    const x0 = positioned ? Number(attr(p.tag, "pcbX")) : c.x, y0 = positioned ? Number(attr(p.tag, "pcbY")) : c.y
    const cleaned = p.tag.replace(/\s+(?:pcbX|pcbY)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "")
    const next = cleaned.replace(/(\bname=["'][^"']+["'])/, `$1 pcbX={${r2(x0 + dx)}} pcbY={${r2(y0 + dy)}}`)
    out = out.replace(tagOf(out, p.name)!, next)
  }
  return out
}

// Two-pin parts that go beside the pin they serve. Caps first (each takes one supply pin), then resistors, then
// LEDs and diodes, which usually hang off a resistor placed just before them.
const MOVABLE = ["simple_capacitor", "simple_resistor", "simple_led", "simple_diode"]
const GROUND = /^(GND|VSS|AGND|DGND|PGND)\d*$/i
const SUPPLY = /^(VCC|VDD|VDDA|VDDIO|VIN|VOUT|VBUS|V3V3|3V3|5V)\d*$/i
const REGULATOR_PIN = /^(VIN|VOUT)\d*$/i
// Room left around a snapped part, a little more than CLEARANCE so the autorouter can get between parts.
const SNAP_CLEARANCE = 0.2
const STEP = 0.1
const REACH = 6

/**
 * Each part's courtyard as tscircuit draws it (a rotated rect keeps its unrotated width/height and carries
 * ccw_rotation), else its outline, else its body. Tighter than courtyards(), which pads it for repairs that aren't
 * re-checked; placeParts re-renders every snapped layout and drops it if tscircuit reports new errors.
 */
function exactCourtyards(els: El[]): Map<string, Box> {
  const out = new Map<string, Box>()
  const grow = (id: string, x0: number, x1: number, y0: number, y1: number) => {
    const b = out.get(id)
    out.set(id, b ? { x0: Math.min(b.x0, x0), x1: Math.max(b.x1, x1), y0: Math.min(b.y0, y0), y1: Math.max(b.y1, y1) } : { x0, x1, y0, y1 })
  }
  for (const e of els) {
    if (e.type === "pcb_courtyard_rect") {
      const sideways = Math.round((e.ccw_rotation ?? 0) / 90) % 2 !== 0
      const w = sideways ? e.height : e.width
      const h = sideways ? e.width : e.height
      grow(e.pcb_component_id, e.center.x - w / 2, e.center.x + w / 2, e.center.y - h / 2, e.center.y + h / 2)
    }
    if (e.type === "pcb_courtyard_outline" && e.outline?.length) {
      const xs = e.outline.map((p: { x: number }) => p.x), ys = e.outline.map((p: { y: number }) => p.y)
      grow(e.pcb_component_id, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys))
    }
  }
  for (const e of els) {
    if (e.type === "pcb_component" && e.center && !out.has(e.pcb_component_id))
      grow(e.pcb_component_id, e.center.x - e.width / 2, e.center.x + e.width / 2, e.center.y - e.height / 2, e.center.y + e.height / 2)
  }
  return out
}

type Pad = { x: number; y: number; net: string; comp: string; name: string }
/** A part's new centre and rotation; `reach` is how far its connecting pad ends up from the pad it serves, mm. */
export type Move = { x: number; y: number; rotation: number; reach: number; cap: boolean }
type Rot = 0 | 90 | 180 | 270
const turn = (x: number, y: number, rot: Rot) =>
  rot === 0 ? { x, y } : rot === 90 ? { x: -y, y: x } : rot === 180 ? { x: -x, y: -y } : { x: y, y: -x }

/**
 * New centres and rotations for the two-pin parts of a render: each one beside the pad it connects to, as close as
 * the other parts' courtyards allow. Parts with no pad to go beside stay where they are.
 */
export function snapPositions(circuitJson: unknown): Map<string, Move> {
  const moves = new Map<string, Move>()
  if (!Array.isArray(circuitJson)) return moves
  const els = circuitJson as El[]
  const source = new Map(els.filter((e) => e.type === "source_component").map((e) => [e.source_component_id, e]))
  const sourcePort = new Map(els.filter((e) => e.type === "source_port").map((e) => [e.source_port_id, e]))
  const outlines = exactCourtyards(els)
  const comps = els.filter((e) => e.type === "pcb_component" && e.center)

  const pads: Pad[] = els.flatMap((p) => {
    if (p.type !== "pcb_port") return []
    const sp = sourcePort.get(p.source_port_id)
    const net = sp?.subcircuit_connectivity_map_key
    return net ? [{ x: p.x, y: p.y, net, comp: p.pcb_component_id, name: sp.name ?? "" }] : []
  })
  const ground = new Set(pads.filter((p) => GROUND.test(p.name)).map((p) => p.net))
  const netSize = (net: string) => pads.filter((p) => p.net === net).length
  const ftype = (pc: El) => source.get(pc.source_component_id)?.ftype as string | undefined

  const movable = comps
    .filter((pc) => MOVABLE.includes(ftype(pc) ?? "") && pads.filter((p) => p.comp === pc.pcb_component_id).length === 2)
    .sort((a, b) => MOVABLE.indexOf(ftype(a)!) - MOVABLE.indexOf(ftype(b)!) ||
      (source.get(b.source_component_id)?.capacitance ?? 0) - (source.get(a.source_component_id)?.capacitance ?? 0))
  /** Parts already where they belong: everything else, plus movable parts once they've moved. */
  const anchored = new Set(comps.filter((pc) => !movable.includes(pc)).map((pc) => pc.pcb_component_id))
  const claimed = new Set<Pad>()
  const chips = new Set(comps.filter((pc) => ftype(pc) === "simple_chip").map((pc) => pc.pcb_component_id))

  for (const pc of movable) {
    const id = pc.pcb_component_id
    const own = pads.filter((p) => p.comp === id)
    // Anchor pads on a net this part shares, ground excluded (everything is on ground). Prefer the most specific
    // net (a cap's supply pin over a header's, a pull-up's SDA over V3V3), then a pad no cap has taken yet.
    const candidates = own.flatMap((mine) =>
      ground.has(mine.net) ? [] : pads.filter((p) => p.net === mine.net && p.comp !== id && anchored.has(p.comp)).map((target) => ({ mine, target })),
    )
    if (!candidates.length) continue
    const d0 = (c: { mine: Pad; target: Pad }) => Math.hypot(c.target.x - pc.center.x, c.target.y - pc.center.y)
    const onChip = (c: { target: Pad }) => (chips.has(c.target.comp) ? 0 : 1)
    // A cap belongs on a supply pin, not on an address strap tied to the same rail; bulk caps (1uF and up) on a
    // regulator's VIN/VOUT, 100nF-class caps on a chip's VCC/VDD.
    const isCap = ftype(pc) === "simple_capacitor"
    const bulk = (source.get(pc.source_component_id)?.capacitance ?? 0) >= 0.9e-6
    const onSupply = (c: { target: Pad }) => (isCap && !SUPPLY.test(c.target.name) ? 1 : 0)
    const sized = (c: { target: Pad }) => (isCap && REGULATOR_PIN.test(c.target.name) !== bulk ? 1 : 0)
    candidates.sort((a, b) =>
      netSize(a.mine.net) - netSize(b.mine.net) || onChip(a) - onChip(b) || onSupply(a) - onSupply(b) || sized(a) - sized(b) ||
      Number(claimed.has(a.target)) - Number(claimed.has(b.target)) || d0(a) - d0(b))
    const { mine, target } = candidates[0]

    // The part's courtyard and its connecting pad at rotation 0, from how it rendered.
    const rot0 = (((pc.rotation ?? 0) % 360) + 360) % 360
    const b = outlines.get(id)!
    const sideways = Math.round(rot0 / 90) % 2 === 1
    const w = sideways ? b.y1 - b.y0 : b.x1 - b.x0
    const h = sideways ? b.x1 - b.x0 : b.y1 - b.y0
    const back = ((360 - Math.round(rot0 / 90) * 90) % 360) as Rot
    const offset = turn(mine.x - pc.center.x, mine.y - pc.center.y, back)

    const obstacles = [...outlines].filter(([other]) => other !== id).map(([, box]) => box)
    let best: { x: number; y: number; rotation: Rot; d: number } | undefined
    const n = Math.round(REACH / STEP)
    for (const rotation of [0, 90, 180, 270] as const) {
      const hw = (rotation % 180 ? h : w) / 2 + SNAP_CLEARANCE
      const hh = (rotation % 180 ? w : h) / 2 + SNAP_CLEARANCE
      const o = turn(offset.x, offset.y, rotation)
      for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
          const x = target.x - o.x + i * STEP
          const y = target.y - o.y + j * STEP
          const d = Math.hypot(i * STEP, j * STEP)
          if (best && d >= best.d) continue
          const box = { x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh }
          if (obstacles.some((ob) => overlaps(box, ob))) continue
          best = { x, y, rotation, d }
        }
      }
    }
    if (!best) continue

    // Move it: courtyard, pads and anchor status follow, so later parts see where it now is.
    const hw = (best.rotation % 180 ? h : w) / 2
    const hh = (best.rotation % 180 ? w : h) / 2
    outlines.set(id, { x0: best.x - hw, x1: best.x + hw, y0: best.y - hh, y1: best.y + hh })
    for (const p of own) {
      const r0 = turn(p.x - pc.center.x, p.y - pc.center.y, back)
      const rel = turn(r0.x, r0.y, best.rotation)
      p.x = best.x + rel.x
      p.y = best.y + rel.y
    }
    anchored.add(id)
    claimed.add(target)
    moves.set(id, { x: best.x, y: best.y, rotation: best.rotation, reach: Math.hypot(mine.x - target.x, mine.y - target.y), cap: ftype(pc) === "simple_capacitor" })
  }
  return moves
}

type Render = (source: string) => Promise<unknown[]>
const errorCount = (json: unknown[]) => (json as El[]).filter((e) => e.type.endsWith("_error")).length

// tscircuit's default packing sometimes leaves no room beside a pin (two chips shoulder to shoulder); a wider gap
// fixes that board but spreads others. Both are tried and the better snapped layout kept.
const PACK_GAPS = [undefined, "2mm"]
// A decoupling cap further than this from its supply pad does little; layouts with fewer of those win.
const CAP_REACH_MM = 2.5

/**
 * The code with every part's position written in: tscircuit's automatic placement, then two-pin parts moved
 * beside the pads they connect to. Of the layouts tried, keeps the one with the fewest render errors, then the
 * fewest decoupling caps far from their pin, then the shortest total distance from each moved part to its pad.
 * Returns the code and its render.
 */
export async function placeParts(source: string, render: Render): Promise<{ source: string; circuitJson: unknown[] }> {
  const auto = withoutPlacement(source)
  type Scored = { source: string; circuitJson: unknown[]; score: number[] }
  let best: Scored | undefined
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
    return false
  }
  for (const gap of PACK_GAPS) {
    if (gap && /<board\b[^>]*\bpcbPackGap=/.test(auto)) continue
    const packed = gap ? auto.replace(/<board\b/, `<board pcbPackGap="${gap}"`) : auto
    const autoJson = await render(packed)
    const moves = [...snapPositions(autoJson)]
    const byId = new Map(moves)
    const moved = (autoJson as El[]).map((e) => {
      const m = e.type === "pcb_component" ? byId.get(e.pcb_component_id) : undefined
      return m ? { ...e, center: { x: m.x, y: m.y }, rotation: m.rotation } : e
    })
    const snapped = bakePlacement(packed, moved)
    const snappedJson = await render(snapped)
    const candidate: Scored = errorCount(snappedJson) <= errorCount(autoJson)
      ? {
          source: snapped,
          circuitJson: snappedJson,
          score: [
            errorCount(snappedJson),
            moves.filter(([, m]) => m.cap && m.reach > CAP_REACH_MM).length,
            moves.reduce((sum, [, m]) => sum + m.reach, 0),
          ],
        }
      // Snapping made it worse: keep tscircuit's positions, locked into the code.
      : { source: bakePlacement(packed, autoJson as El[]), circuitJson: autoJson, score: [errorCount(autoJson), Infinity, Infinity] }
    if (!best || better(candidate.score, best.score)) best = candidate
  }
  return { source: best!.source, circuitJson: best!.circuitJson }
}
