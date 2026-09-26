// Metrics are derived from the board itself wherever possible, so the readout
// cannot drift away from what is on screen. Only DRC errors are carried on the
// snapshot, because "a rule is currently violated" is a checker verdict rather
// than something visible in the geometry.

import type { BuildSnapshot, DesignMetrics, PCBState } from "./types";

export function deriveMetrics(
  pcb: PCBState,
  snapshot: BuildSnapshot | null,
): DesignMetrics {
  return {
    components: pcb.components.length,
    nets: pcb.traces.length,
    drcErrors: snapshot?.drcErrors ?? 0,
    boardWidthMm: pcb.board.widthMm,
    boardHeightMm: pcb.board.heightMm,
    bomUsd: pcb.components.reduce((sum, c) => sum + (c.costUsd ?? 0), 0),
  };
}
