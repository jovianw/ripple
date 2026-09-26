// The live dependencies for a planned (long-horizon) board: planner via the router, Arjun's coder, lessons per
// subcircuit from memory, and the critic for repair rounds. Owner: Marcos. Used by `npm run finale` and the
// spec-request worker, so web-triggered finale runs behave exactly like the CLI.
import type { HarnessConfig } from "@ripple/types"
import { createComplete } from "../tools/router.js"
import { runCoder } from "../agents/coder.js"
import { runCritic } from "../agents/critic/index.js"
import { addLesson, retrieveLessons } from "../harness/memory.js"
import type { PlannedBoardDeps, PlannedBoardSpec } from "./planned-board.js"

export function liveDeps(spec: PlannedBoardSpec, boardId: string, config: HarnessConfig, log?: (m: string) => void): PlannedBoardDeps {
  return {
    planner: { complete: createComplete("planner", config) as PlannedBoardDeps["planner"]["complete"] },
    coder: (input) => runCoder(input) as never,
    lessons: (query) => retrieveLessons(query, config.context) as never,
    // The critic diagnoses each block the assembled board blamed; its lessons go into memory.
    async critic({ code, failures, round, maxRounds }) {
      const c = await runCritic(
        {
          spec: { _id: spec._id, text: spec.text, split: "train" }, code,
          result: { board_id: boardId, harness_version: config.version, stage: "final", passed: false, failures, drc_errors: 0, ts: new Date().toISOString() },
          lessons: [], rules: config.rules, attempt: round, repairBudget: maxRounds,
        },
        { complete: createComplete("critic", config) as never, addLesson },
      )
      if (c.saved_lesson_ids.length) log?.(`critic stored ${c.saved_lesson_ids.length} lesson(s)`)
      return [...c.diagnosis.map((d) => `${d.check}: ${d.cause}`), ...c.fix].join("\n")
    },
    log,
  }
}
