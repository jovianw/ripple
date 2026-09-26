"use client";

import { STAGES, type BuildStage } from "@/lib/types";

export function StageProgress({
  stage,
  failed,
}: {
  stage: BuildStage | null;
  failed: boolean;
}) {
  const currentIndex = stage ? STAGES.findIndex((s) => s.id === stage) : -1;

  return (
    <ol className="flex items-center gap-1 overflow-x-auto px-4 py-2.5">
      {STAGES.map((s, i) => {
        const done = currentIndex > i;
        const active = currentIndex === i;
        const isFailingCheck = active && failed;

        return (
          <li key={s.id} className="flex shrink-0 items-center gap-1">
            <span
              className={[
                "rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors",
                isFailingCheck
                  ? "bg-bad/15 text-bad"
                  : active
                    ? "bg-accent/15 text-accent"
                    : done
                      ? "text-good/70"
                      : "text-faint",
              ].join(" ")}
            >
              {done ? "✓ " : ""}
              {s.label}
            </span>
            {i < STAGES.length - 1 ? (
              <span
                className={`h-px w-4 ${done ? "bg-good/40" : "bg-line-strong"}`}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
