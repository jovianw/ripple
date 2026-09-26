"use client";

import type { BuildSnapshot } from "@/lib/types";

const AGENT_LABEL: Record<string, string> = {
  planner: "Planner",
  coder: "Coder",
  critic: "Critic",
  checker: "Checker",
  meta: "Meta",
};

/**
 * The current action, floating directly in the world. No panel: the type and
 * the space around it do the work, so the board stays uninterrupted behind it.
 */
export function WorldHud({
  snapshot,
  progress,
  totalSteps,
}: {
  snapshot: BuildSnapshot;
  progress: number;
  totalSteps: number;
}) {
  const ink =
    snapshot.status === "error"
      ? "text-bad"
      : snapshot.status === "warning"
        ? "text-warn"
        : snapshot.stage === "complete"
          ? "text-good"
          : "text-ink";

  const rule =
    snapshot.status === "error"
      ? "bg-bad"
      : snapshot.status === "warning"
        ? "bg-warn"
        : snapshot.stage === "complete"
          ? "bg-good"
          : "bg-accent";

  return (
    <div className="pointer-events-none max-w-[22rem]">
      <div className={`text-[20px] font-medium leading-tight ${ink}`}>
        {snapshot.message}
      </div>

      <div className="mt-1.5 flex items-baseline gap-2 text-[12px] text-faint">
        <span>{AGENT_LABEL[snapshot.agent] ?? snapshot.agent}</span>
        <span className="text-ghost">·</span>
        <span className="font-mono [font-variant-numeric:tabular-nums]">
          {String(snapshot.version + 1).padStart(2, "0")} / {totalSteps}
        </span>
        {snapshot.summary?.[1] ? (
          <>
            <span className="text-ghost">·</span>
            <span className="font-mono">{snapshot.summary[1]}</span>
          </>
        ) : null}
      </div>

      {/* One hairline of progress, no track chrome. */}
      <div className="mt-3 h-px w-40 bg-hair">
        <div
          className={`h-px transition-[width] duration-500 ease-out ${rule}`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
