// Mechanical fixes to coder output that don't change the design. Pure string functions, no DB or model, so both
// Arjun's runCoder (single boards: training, evolve, ablation, free text) and the finale pipeline can use them.
// Owner: Marcos.

/**
 * Mechanical fixes to coder output that don't change the design:
 * - trace-length limits only ever block the autorouter. tscircuit gives every power-to-ground capacitor a 1mm
 *   maximum trace automatically, so each capacitor gets an explicit, generous maxDecouplingTraceLength; coder-set
 *   maxLength/decouplingFor/decouplingTo are removed. The hidden checks still enforce the 3mm placement rule.
 * - ".R1.pin2" selectors -> ".R1 > .pin2"; numeric pinLabels keys ("1") -> "pin1"; pcbX={{12}} -> pcbX={12}.
 * - pin labels tscircuit rejects ("3.3V", "+5V") -> ones it accepts ("3V3", "5V"); see validPinLabels.
 */
export function normalizeCoderSource(source: string): string {
  return validPinLabels(source)
    .replace(/\s+(?:maxLength|maxDecouplingTraceLength|decouplingFor|decouplingTo)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "")
    .replace(/<capacitor\b/g, "<capacitor maxDecouplingTraceLength={1000}")
    // pcbX={{12}} (a coder copying JSX from fix text) doesn't compile: one pair of braces.
    .replace(/\b(pcbX|pcbY|pcbRotation)=\{\{\s*(-?[\d.]+)\s*\}\}/g, "$1={$2}")
    .replace(/\b(from|to)="\.([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)"/g, '$1=".$2 > .$3"')
    // pinLabels={{"1":"MISO"}} -> pinLabels={{"pin1":"MISO"}}: tscircuit ignores numeric keys.
    .replace(/pinLabels=\{\{([^}]*)\}\}/g, (_m, body: string) =>
      `pinLabels={{${body.replace(/(^|[{,]\s*)["']?(\d+)["']?\s*:/g, '$1"pin$2":')}}}`)
}

/** A pin label tscircuit accepts: letters, digits and "_" only. "3.3V" -> "3V3", "1.8V" -> "1V8", "+5V" -> "5V". */
export function validPinLabel(label: string): string {
  if (/^\w+$/.test(label)) return label
  const fixed = label
    .trim()
    .replace(/^(\d+)\.(\d+)\s*V$/i, "$1V$2")
    .replace(/^(\d+)\s+V$/i, "$1V")
    .replace(/^\+/, "")
    .replace(/\W+/g, "_")
    .replace(/^_+|_+$/g, "")
  return fixed || "PIN"
}

/**
 * The spec's wording ends up in pinLabels ("Break out 3.3V and GND"), and tscircuit then refuses to create the part:
 * nothing can connect to it and the whole board fails. Renames each rejected label, and the trace selectors that
 * use it (".J1 > .3.3V").
 */
export function validPinLabels(source: string): string {
  let out = source
  for (const tag of source.match(/<[A-Za-z]+\b[^>]*?\bpinLabels=\{[\s\S]*?\}\}?[^>]*>/g) ?? []) {
    const name = tag.match(/\bname=["']([^"']+)["']/)?.[1]
    const renamed = new Map<string, string>()
    const fixedTag = tag.replace(/(pinLabels=\{)(\[[^\]]*\]|\{[^}]*\})(\})/, (_m, open: string, body: string, close: string) =>
      open +
      body.replace(/(["'])([^"']*)\1(\s*[,\]}])/g, (lit, q: string, label: string, after: string) => {
        const valid = validPinLabel(label)
        if (valid === label) return lit
        renamed.set(label, valid)
        return `${q}${valid}${q}${after}`
      }) +
      close)
    if (!renamed.size) continue
    out = out.replace(tag, fixedTag)
    if (!name) continue
    for (const [from, to] of renamed)
      out = out.replace(new RegExp(`(\\.${esc(name)}\\s*>\\s*\\.)${esc(from)}(["'])`, "g"), `$1${to}$2`)
  }
  return out
}

/** The same code with the coder's positions removed, so tscircuit places the parts itself (no overlaps). */
export function withoutPlacement(source: string): string {
  return source.replace(/\s+(?:pcbX|pcbY|pcbRotation)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "")
}

const POSITION = /\s+(?:pcbX|pcbY|pcbRotation)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * A repair edits code whose parts are all pinned (bakePlacement). If the coder drops a part's pcbX/pcbY while
 * editing, that part lands at the origin on top of others; put back the position it had in `previous`.
 */
export function keepPlacement(source: string, previous: string): string {
  let out = source
  for (const tag of previous.match(/<[A-Za-z]+\b[^>]*?\bname=["'][^"']+["'][^>]*>/g) ?? []) {
    const name = tag.match(/\bname=["']([^"']+)["']/)![1]
    const attrs = (tag.match(POSITION) ?? []).join("")
    if (!attrs) continue
    const current = out.match(new RegExp(`<[A-Za-z]+\\b[^>]*?\\bname=["']${esc(name)}["'][^>]*>`))?.[0]
    if (!current || /\bpcbX=/.test(current)) continue
    out = out.replace(current, current.replace(/(\bname=["'][^"']+["'])/, `$1${attrs}`))
  }
  return out
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
