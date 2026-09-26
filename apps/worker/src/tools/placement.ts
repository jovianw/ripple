// Board geometry from a render: courtyards, clear spots, and positions for parts the code left unplaced.
// Owner: Marcos. Pure functions on Circuit JSON and source text; no DB, no model.
//
// Repairs pin every existing part (bakePlacement), so fixing one part doesn't re-pack the rest. Parts a repair adds
// or moves are placed by the model's guess (or not at all, and tscircuit doesn't fit them around pinned parts), and
// land on top of others. settlePlacement moves just those to the nearest clear spot.

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
