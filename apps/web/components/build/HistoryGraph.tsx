"use client";

import type { BuildSnapshot } from "@/lib/types";

/**
 * State history as a small graph rather than a row of identical dots.
 *
 * The failed check drops below the main line and the repair steps sit on that
 * lower branch, rejoining at the pass — so the shape itself says the repair
 * exists *because* the check failed.
 */
export function HistoryGraph({
  snapshots,
  currentIndex,
  totalCount,
  isLive,
  onScrub,
  onReturnToLive,
}: {
  snapshots: BuildSnapshot[];
  currentIndex: number;
  totalCount: number;
  isLive: boolean;
  onScrub: (index: number) => void;
  onReturnToLive: () => void;
}) {
  if (snapshots.length === 0) return null;

  const branchOf = (s: BuildSnapshot): boolean =>
    s.status === "error" || s.stage === "repair";

  return (
    <div className="flex items-center gap-5">
      <ol className="flex items-end">
        {snapshots.map((snapshot, i) => {
          const isCurrent = i === currentIndex;
          const isPast = i < currentIndex;
          const failed = snapshot.status === "error";
          const onBranch = branchOf(snapshot);

          const dot = failed
            ? "bg-bad"
            : snapshot.stage === "repair"
              ? isCurrent || isPast
                ? "bg-warn"
                : "bg-ghost"
              : isCurrent
                ? "bg-accent"
                : isPast
                  ? "bg-faint"
                  : "bg-ghost";

          return (
            <li key={snapshot.version} className="flex items-end">
              {i > 0 ? (
                <span
                  className={`mb-[11px] h-px w-3 ${
                    isPast || isCurrent ? "bg-ghost" : "bg-hair"
                  }`}
                  aria-hidden
                />
              ) : null}

              <button
                type="button"
                onClick={() => onScrub(i)}
                title={
                  snapshot.summary
                    ? `${snapshot.summary[0]} — ${snapshot.summary[1] ?? ""}`
                    : snapshot.tick
                }
                className="group flex flex-col items-center"
                aria-current={isCurrent}
                // The branch: failure and repair sit a step lower than the
                // main line, then the pass returns to it.
                style={{ paddingBottom: onBranch ? 0 : "0.7rem" }}
              >
                <span
                  className={`text-[9px] leading-none transition-colors ${
                    isCurrent ? "text-dim" : "text-transparent group-hover:text-ghost"
                  }`}
                >
                  {snapshot.tick}
                </span>
                <span
                  className={`mt-1 h-[6px] w-[6px] rounded-full transition-colors ${dot} ${
                    isCurrent ? "ring-[3px] ring-white/10" : ""
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ol>

      {!isLive ? (
        <button
          type="button"
          onClick={onReturnToLive}
          className="shrink-0 text-[12px] text-warn hover:text-ink"
        >
          <span className="text-faint">
            history {currentIndex + 1}/{totalCount}
          </span>
          <span className="ml-2">return to live →</span>
        </button>
      ) : null}
    </div>
  );
}
