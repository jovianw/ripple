// Mechanical fixes to coder output that don't change the design. Pure string functions, no DB or model, so both
// Arjun's runCoder (single boards: training, evolve, ablation, free text) and the finale pipeline can use them.
// Owner: Marcos.

/**
 * Mechanical fixes to coder output that don't change the design:
 * - trace-length limits only ever block the autorouter. tscircuit gives every power-to-ground capacitor a 1mm
 *   maximum trace automatically, so each capacitor gets an explicit, generous maxDecouplingTraceLength; coder-set
 *   maxLength/decouplingFor/decouplingTo are removed. The hidden checks still enforce the 3mm placement rule.
 * - ".R1.pin2" selectors -> ".R1 > .pin2"; numeric pinLabels keys ("1") -> "pin1"; pcbX={{12}} -> pcbX={12}.
 */
export function normalizeCoderSource(source: string): string {
  return source
    .replace(/\s+(?:maxLength|maxDecouplingTraceLength|decouplingFor|decouplingTo)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "")
    .replace(/<capacitor\b/g, "<capacitor maxDecouplingTraceLength={1000}")
    // pcbX={{12}} (a coder copying JSX from fix text) doesn't compile: one pair of braces.
    .replace(/\b(pcbX|pcbY|pcbRotation)=\{\{\s*(-?[\d.]+)\s*\}\}/g, "$1={$2}")
    .replace(/\b(from|to)="\.([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)"/g, '$1=".$2 > .$3"')
    // pinLabels={{"1":"MISO"}} -> pinLabels={{"pin1":"MISO"}}: tscircuit ignores numeric keys.
    .replace(/pinLabels=\{\{([^}]*)\}\}/g, (_m, body: string) =>
      `pinLabels={{${body.replace(/(^|[{,]\s*)["']?(\d+)["']?\s*:/g, '$1"pin$2":')}}}`)
}

/** The same code with the coder's positions removed, so tscircuit places the parts itself (no overlaps). */
export function withoutPlacement(source: string): string {
  return source.replace(/\s+(?:pcbX|pcbY|pcbRotation)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "")
}

type El = { type: string; [k: string]: any }
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Writes the positions tscircuit chose (from a render of `source`) back into the code as pcbX/pcbY/pcbRotation, so
 * the block lands in the same place every time it's rendered: alone for measuring, and inside the assembled board.
 * Automatic placement alone can differ between those two contexts, which let parts of different blocks overlap.
 */
export function bakePlacement(source: string, circuitJson: El[]): string {
  const names = new Map(circuitJson.filter((e) => e.type === "source_component").map((c) => [c.source_component_id, c.name as string]))
  let out = source
  for (const pc of circuitJson.filter((e) => e.type === "pcb_component" && e.center)) {
    const name = names.get(pc.source_component_id)
    if (!name) continue
    const rot = round2(pc.rotation ?? 0)
    const attrs = ` pcbX={${round2(pc.center.x)}} pcbY={${round2(pc.center.y)}}${rot ? ` pcbRotation={${rot}}` : ""}`
    out = out.replace(new RegExp(`(<[A-Za-z]+\\b[^>]*?\\bname=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'])`), `$1${attrs}`)
  }
  return out
}
