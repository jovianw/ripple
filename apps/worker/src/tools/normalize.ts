// Mechanical fixes to coder output that don't change the design. Pure string functions, no DB or model, so both
// Arjun's runCoder (single boards: training, evolve, ablation, free text) and the finale pipeline can use them.
// Owner: Marcos.

/**
 * Mechanical fixes to coder output that don't change the design:
 * - trace-length limits only ever block the autorouter. tscircuit gives every power-to-ground capacitor a 1mm
 *   maximum trace automatically, so each capacitor gets an explicit, generous maxDecouplingTraceLength; coder-set
 *   maxLength/decouplingFor/decouplingTo are removed. The hidden checks still enforce the 3mm placement rule.
 * - ".R1.pin2" selectors -> ".R1 > .pin2"; numeric pinLabels keys ("1") -> "pin1".
 */
export function normalizeCoderSource(source: string): string {
  return source
    .replace(/\s+(?:maxLength|maxDecouplingTraceLength|decouplingFor|decouplingTo)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "")
    .replace(/<capacitor\b/g, "<capacitor maxDecouplingTraceLength={1000}")
    .replace(/\b(from|to)="\.([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)"/g, '$1=".$2 > .$3"')
    // pinLabels={{"1":"MISO"}} -> pinLabels={{"pin1":"MISO"}}: tscircuit ignores numeric keys.
    .replace(/pinLabels=\{\{([^}]*)\}\}/g, (_m, body: string) =>
      `pinLabels={{${body.replace(/(^|[{,]\s*)["']?(\d+)["']?\s*:/g, '$1"pin$2":')}}}`)
}

/** The same code with the coder's positions removed, so tscircuit places the parts itself (no overlaps). */
export function withoutPlacement(source: string): string {
  return source.replace(/\s+(?:pcbX|pcbY|pcbRotation)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, "")
}
