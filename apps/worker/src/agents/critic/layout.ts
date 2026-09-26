// Where tscircuit actually put each part, for the critic. Owner: Marcos.
// Without it the critic guesses geometry from the code: it placed caps relative to a chip's centre (VCC on a SOIC-8
// is a corner pad) and at centre-to-centre distances that overlap courtyards. Plain geometry from the attempt's own
// render; nothing from the hidden checks.

type El = { type: string; [k: string]: any }

// Pins worth listing on a chip: supplies and grounds, where decoupling caps go.
const POWER_PIN = /^(VCC|VDD|VDDA|VDDIO|VIN|VOUT|VBUS|V3V3|3V3|5V|GND|AGND|VSS)\d*$/i

const n = (v: number) => (Math.abs(v) < 0.005 ? "0" : v.toFixed(2).replace(/\.?0+$/, ""))
const pt = (x: number, y: number) => `(${n(x)}, ${n(y)})`

/** Courtyard (or body, when there is none) of each pcb component as a bounding box. */
function boxes(els: El[]): Map<string, { x0: number; x1: number; y0: number; y1: number }> {
  const out = new Map<string, { x0: number; x1: number; y0: number; y1: number }>()
  const grow = (id: string, xs: number[], ys: number[]) => {
    const b = out.get(id)
    const next = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
    out.set(id, b ? { x0: Math.min(b.x0, next.x0), x1: Math.max(b.x1, next.x1), y0: Math.min(b.y0, next.y0), y1: Math.max(b.y1, next.y1) } : next)
  }
  for (const e of els) {
    if (e.type === "pcb_courtyard_rect")
      grow(e.pcb_component_id, [e.center.x - e.width / 2, e.center.x + e.width / 2], [e.center.y - e.height / 2, e.center.y + e.height / 2])
    if (e.type === "pcb_courtyard_outline" && e.outline?.length)
      grow(e.pcb_component_id, e.outline.map((p: { x: number }) => p.x), e.outline.map((p: { y: number }) => p.y))
  }
  for (const e of els) {
    if (e.type === "pcb_component" && !out.has(e.pcb_component_id))
      grow(e.pcb_component_id, [e.center.x - e.width / 2, e.center.x + e.width / 2], [e.center.y - e.height / 2, e.center.y + e.height / 2])
  }
  return out
}

/**
 * One line per part: where its centre is, whether the code set that position, its courtyard,
 * and pad positions (a chip's supply/ground pins; every pin of anything smaller). Empty when the board didn't render.
 */
export function describeLayout(circuitJson: unknown): string {
  if (!Array.isArray(circuitJson)) return ""
  const els = circuitJson as El[]
  const source = new Map(els.filter((e) => e.type === "source_component").map((e) => [e.source_component_id, e]))
  const sourcePort = new Map(els.filter((e) => e.type === "source_port").map((e) => [e.source_port_id, e]))
  const courtyards = boxes(els)
  const lines: string[] = []

  for (const pc of els.filter((e) => e.type === "pcb_component")) {
    const sc = source.get(pc.source_component_id)
    if (!sc?.name) continue
    const ports = els
      .filter((e) => e.type === "pcb_port" && e.pcb_component_id === pc.pcb_component_id)
      .flatMap((p) => {
        const sp = sourcePort.get(p.source_port_id)
        return sp ? [{ p, sp }] : []
      })
    const isChip = sc.ftype === "simple_chip"
    const shown = isChip ? ports.filter(({ sp }) => POWER_PIN.test(sp.name)) : ports
    const pads = shown
      .map(({ p, sp }) => {
        const pin = sp.pin_number !== undefined ? `pin${sp.pin_number}` : ""
        const label = sp.name && sp.name !== pin ? `${sp.name} ${pin}`.trim() : pin || sp.name
        return `${label} ${pt(p.x, p.y)}`
      })
      .join(", ")
    const b = courtyards.get(pc.pcb_component_id)
    // pcbX/pcbY in the code render as "relative_to_group_anchor"; anything else was left to tscircuit, which packs
    // it or leaves it at the origin.
    const placed = pc.position_mode === "relative_to_group_anchor" ? "fixed by the code" : "no pcbX/pcbY in the code"
    lines.push(
      `- ${sc.name}: centre ${pt(pc.center.x, pc.center.y)}, ${placed}` +
        (b ? `; courtyard x ${n(b.x0)}..${n(b.x1)}, y ${n(b.y0)}..${n(b.y1)}` : "") +
        (pads ? `; pads ${pads}` : ""),
    )
  }
  return lines.join("\n")
}
