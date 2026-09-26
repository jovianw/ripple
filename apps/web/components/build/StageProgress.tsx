"use client";

import { STAGES, type BuildStage } from "@/lib/types";

/**
 * The run's shape, including the part that failed. A check that failed and was
 * repaired stays marked as failed once passed — the failure is part of the
 * story, not something to tidy away.
 */
export function StageProgress({
  stage,
  failed,
  checkFailed,
}: {
  stage: BuildStage | null;
  /** The current stage is in an error state right now. */
  failed: boolean;
  /** A check failed at some point during this run. */
  checkFailed: boolean;
}) {
  const currentIndex = stage ? STAGES.findIndex((s) => s.id === stage) : -1;

  return (
    <ol className="flex items-center gap-1 overflow-x-auto px-4 py-2">
      {STAGES.map((s, i) => {
        const done = currentIndex > i;
        const active = currentIndex === i;

        // "Check" keeps its cross after the repair, so the rail reads
        // plan -> ... -> check ✕ -> repair -> pass.
        const failedHere =
          (active && failed) || (s.id === "checking" && checkFailed && done);
        const repairTone = s.id === "repair" && (active || done);

        const glyph = failedHere ? "✕" : done ? "✓" : null;

        const tone = failedHere
          ? "bg-bad/12 text-bad"
          : active
            ? repairTone
              ? "bg-warn/12 text-warn"
              : "bg-accent/12 text-accent"
            : done
              ? repairTone
                ? "text-warn/60"
                : "text-good/60"
              : "text-faint";

        return (
          <li key={s.id} className="flex shrink-0 items-center gap-1">
            <span
              className={`rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${tone}`}
            >
              {glyph ? <span className="mr-1">{glyph}</span> : null}
              {s.label}
            </span>
            {i < STAGES.length - 1 ? (
              <span
                className={`h-px w-3 ${done ? "bg-line-strong" : "bg-line"}`}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
