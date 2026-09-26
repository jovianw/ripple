// Critic agent. Owner: Marcos.
// Model-agnostic: the model router (Arjun) is passed in as `complete`, lesson storage (Jovian) as `addLesson`.
import { CRITIC_SCHEMA, CRITIC_SYSTEM, criticUserPrompt, type CriticInput, type CriticOutput } from "./prompt.js"

export { CRITIC_SYSTEM, CRITIC_SCHEMA, criticUserPrompt, compactWhitelist, type CriticInput, type CriticOutput } from "./prompt.js"
export { IMPROVE_SYSTEM, IMPROVE_SCHEMA, improveUserPrompt, runImprover, type ImproveInput, type ImproveOutput } from "./improve.js"

export interface CriticDeps {
  /** Calls the critic's model with a JSON schema; returns the parsed JSON. */
  complete(system: string, user: string, schema: typeof CRITIC_SCHEMA): Promise<unknown>
  /** Stores a lesson (memory.addLesson); returns its id. Omit when the run must not write memory (free text from the web). */
  addLesson?(lesson: { pattern: string; fix: string }): Promise<string>
}

export interface CriticResult extends CriticOutput {
  /** Lessons dropped by the quality gate, with the reason. */
  rejected_lessons: { pattern: string; fix: string; reason: string }[]
  /** Ids of lessons stored in Atlas. */
  saved_lesson_ids: string[]
}

// Component designators like U3, R12, LED1, C4, J2: a lesson that names one is a patch, not a rule.
const DESIGNATOR = /\b(?:[RCUJDQLYSK]|LED|SW)\d+\b/

/** Why a lesson fails the quality gate, or undefined if it passes. */
export function lessonProblem(l: { pattern: string; fix: string }): string | undefined {
  if (l.pattern.trim().length < 8 || l.fix.trim().length < 20) return "too short to be a rule"
  const m = DESIGNATOR.exec(`${l.pattern} ${l.fix}`)
  if (m) return `names a specific part (${m[0]})`
  if (/\b[th]\d{2}_/.test(`${l.pattern} ${l.fix}`)) return "names a spec id"
  if (/maxLength|max_length|maximum (trace )?length|trace length/i.test(l.fix)) return "sets a routing constraint"
  return undefined
}

export async function runCritic(input: CriticInput, deps: CriticDeps): Promise<CriticResult> {
  const raw = (await deps.complete(CRITIC_SYSTEM, criticUserPrompt(input), CRITIC_SCHEMA)) as CriticOutput
  const out: CriticOutput = {
    diagnosis: raw.diagnosis ?? [],
    fix: raw.fix ?? [],
    lessons: (raw.lessons ?? []).slice(0, 2),
    lessons_ignored: raw.lessons_ignored ?? [],
    escalate: !!raw.escalate,
    escalate_reason: raw.escalate ? raw.escalate_reason : undefined,
  }
  const rejected: CriticResult["rejected_lessons"] = []
  let keep = out.lessons
  // Held-out specs never teach: lessons from the test set would inflate the ablation.
  if (input.spec.split === "held_out") {
    rejected.push(...keep.map((l) => ({ ...l, reason: "held-out spec" })))
    keep = []
  }
  // No storage: the caller's board must not teach (ungraded free text); keep the diagnosis, drop the lessons.
  if (!deps.addLesson) {
    rejected.push(...keep.map((l) => ({ ...l, reason: "memory writes off" })))
    keep = []
  }
  keep = keep.filter((l) => {
    const why = lessonProblem(l)
    if (why) rejected.push({ ...l, reason: why })
    return !why
  })
  const saved = []
  for (const l of keep) saved.push(await deps.addLesson!(l))
  return { ...out, lessons: keep, rejected_lessons: rejected, saved_lesson_ids: saved }
}
