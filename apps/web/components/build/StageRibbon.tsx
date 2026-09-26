"use client";

import { STAGES, type BuildStage } from "@/lib/types";

/**
 * The run's shape as a thin execution ribbon. Reads left to right in lower
 * case, with the failed check dropping off the line and repair rejoining it —
 * a compact graph of what happened, not a checkout stepper.
 */
export function StageRibbon({
  stage,
  failed,
  checkFailed,
}: {
  stage: BuildStage | null;
  failed: boolean;
  checkFailed: boolean;
}) {
  const currentIndex = stage ? STAGES.findIndex((s) => s.id === stage) : -1;

  return (
    <ol className="flex items-center gap-2.5 text-[12px]">
      {STAGES.map((s, i) => {
        const done = currentIndex > i;
        const active = currentIndex === i;
        const brokeHere =
          (active && failed) || (s.id === "checking" && checkFailed && done);
        const repairTone = s.id === "repair" && (active || done);

        const ink = brokeHere
          ? "text-bad"
          : active
            ? repairTone
              ? "text-warn"
              : "text-accent"
            : done
              ? "text-faint"
              : "text-ghost";

        return (
          <li key={s.id} className="flex items-center gap-2.5">
            <span className="relative">
              <span className={ink}>{s.label.toLowerCase()}</span>
              {/* The break in the line lives under the stage that failed. */}
              {brokeHere ? (
                <span
                  className="absolute -bottom-[5px] left-0 right-0 h-px bg-bad"
                  aria-hidden
                />
              ) : active ? (
                <span
                  className={`absolute -bottom-[5px] left-0 right-0 h-px ${
                    repairTone ? "bg-warn" : "bg-accent"
                  }`}
                  aria-hidden
                />
              ) : null}
            </span>
            {i < STAGES.length - 1 ? (
              <span
                className={done ? "text-ghost" : "text-ghost/50"}
                aria-hidden
              >
                /
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
