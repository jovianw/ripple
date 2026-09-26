// Atlas side of the critic: context retrieval before the call, lesson and failure writes after.
// Kept apart from critic.ts so the agent and its tests never open a database connection.
import type { HarnessConfig } from "@ripple/types";
import { addLesson, indexFailure, retrieveLessons, similarFailures } from "../harness/memory.js";
import type { CriticResult } from "./critic.js";

const SIMILAR_FAILURES_K = 3;

/** Lessons and similar past failures for a failure summary, sized by the config's context policy. */
export async function criticContext(summary: string, config: HarnessConfig) {
  const [lessons, similar] = await Promise.all([
    retrieveLessons(summary, config.context),
    similarFailures(summary, SIMILAR_FAILURES_K, config.context).catch(() => []),
  ]);
  return {
    lessons: lessons.map((l) => ({ _id: l._id, pattern: l.pattern, fix: l.fix })),
    similarFailures: similar.map((r) => r.failure_summary).filter((s): s is string => !!s),
  };
}

/** Stores the critic's lessons (idempotent per pattern) and indexes the failed run for later retrieval. */
export async function recordCritic(runId: string, critic: CriticResult): Promise<{ lessonIds: string[] }> {
  const lessonIds: string[] = [];
  for (const lesson of critic.lessons) lessonIds.push(await addLesson(lesson));
  await indexFailure(runId, critic.failure_summary);
  return { lessonIds };
}
