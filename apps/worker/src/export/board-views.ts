// Stores a board's web views (buildBoardViews) on one record in `boards`, where the web app's deliverables API reads
// them. Owner: Marcos. The worker calls this once a spec request finishes, so the panel shows the board that was just
// built instead of the committed t04 example. A planned board (the finale) shows its best assembled round, the one
// that's exported, not the last one.
import type { AnyCircuitElement } from "circuit-json"
import { col } from "../db.js"
import { bestFinal } from "../pipeline/planned-board.js"
import { buildBoardViews } from "./deliverables.js"

/** Returns the stored file paths, or null when the board has no rendered attempt to build from. */
export async function saveBoardViews(boardId: string, specId?: string): Promise<string[] | null> {
  // Boards keep one record per attempt (and a planned board one per subcircuit and round): the best assembled round
  // if there is one, else the latest record that rendered.
  const best = await bestFinal(boardId)
  const [board] = Array.isArray(best?.circuit_json)
    ? [best!]
    : await col.boards
        .find({ board_id: boardId, circuit_json: { $type: "array" } }, { projection: { circuit_json: 1, spec_id: 1 } })
        .sort({ created_at: -1 })
        .limit(1)
        .toArray()
  if (!board) return null
  const views = await buildBoardViews(board.circuit_json as AnyCircuitElement[], boardId, specId ?? board.spec_id)
  await col.boards.updateOne({ _id: board._id }, { $set: { deliverables: views } })
  // The web API serves the newest record with views, so drop any left on other records (e.g. a later, worse round).
  await col.boards.updateMany({ board_id: boardId, _id: { $ne: board._id }, deliverables: { $exists: true } }, { $unset: { deliverables: "" } })
  return views.files.map((f) => f.path)
}
