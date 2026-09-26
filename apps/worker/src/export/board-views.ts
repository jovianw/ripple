// Stores a board's web views (buildBoardViews) on its latest record in `boards`, where the web app's deliverables
// API reads them. Owner: Marcos. The worker calls this once a spec request finishes, so the panel shows the board
// that was just built instead of the committed t04 example.
import type { AnyCircuitElement } from "circuit-json"
import { col } from "../db.js"
import { buildBoardViews } from "./deliverables.js"

/** Returns the stored file paths, or null when the board has no rendered attempt to build from. */
export async function saveBoardViews(boardId: string, specId?: string): Promise<string[] | null> {
  // Boards keep one record per attempt; the panel shows the latest one that rendered.
  const [board] = await col.boards
    .find({ board_id: boardId, circuit_json: { $type: "array" } }, { projection: { circuit_json: 1, spec_id: 1 } })
    .sort({ created_at: -1 })
    .limit(1)
    .toArray()
  if (!board) return null
  const views = await buildBoardViews(board.circuit_json as AnyCircuitElement[], boardId, specId ?? board.spec_id)
  await col.boards.updateOne({ _id: board._id }, { $set: { deliverables: views } })
  return views.files.map((f) => f.path)
}
