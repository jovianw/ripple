"use client";

import type { BuildSnapshot, BuildStage } from "@/lib/types";

const STAGE_TITLE: Record<BuildStage, string> = {
  planning: "Planning",
  placement: "Placement",
  wiring: "Wiring",
  routing: "Routing",
  checking: "Checking",
  repair: "Repair",
  complete: "Complete",
};

/**
 * Small heads-up readout in the corner of the canvas: what phase Ripple is in,
 * what it is doing right now, and how far through the run it is. Sized to stay
 * out of the board's way.
 */
export function OperationOverlay({
  snapshot,
  progress,
}: {
  snapshot: BuildSnapshot;
  progress: number;
}) {
  const tone =
    snapshot.status === "error"
      ? "text-bad"
      : snapshot.status === "warning"
        ? "text-warn"
        : snapshot.status === "success"
          ? "text-good"
          : "text-accent";

  const bar =
    snapshot.status === "error"
      ? "bg-bad"
      : snapshot.status === "warning"
        ? "bg-warn"
        : "bg-accent";

  return (
    <div className="pointer-events-none w-[15rem] rounded-sm border border-line bg-panel/80 px-3 py-2 backdrop-blur-sm">
      <div
        className={`font-mono text-[10px] uppercase tracking-[0.2em] ${tone}`}
      >
        {STAGE_TITLE[snapshot.stage]}
      </div>
      <div className="mt-1 text-[13px] leading-snug text-ink">
        {snapshot.message}
      </div>
      <div className="mt-2 h-px w-full bg-line-strong">
        <div
          className={`h-px transition-[width] duration-300 ease-out ${bar}`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
