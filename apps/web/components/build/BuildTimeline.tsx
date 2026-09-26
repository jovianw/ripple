"use client";

import type { BuildSnapshot } from "@/lib/types";

export function BuildTimeline({
  snapshots,
  currentIndex,
  isLive,
  onScrub,
  onReturnToLive,
}: {
  snapshots: BuildSnapshot[];
  currentIndex: number;
  isLive: boolean;
  onScrub: (index: number) => void;
  onReturnToLive: () => void;
}) {
  if (snapshots.length === 0) return null;

  return (
    <div className="flex items-center gap-4 px-4 py-2.5">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
        Build history
      </span>

      <ol className="slim-scroll flex flex-1 items-start gap-0 overflow-x-auto">
        {snapshots.map((snapshot, i) => {
          const isCurrent = i === currentIndex;
          const isPast = i < currentIndex;
          const failed = snapshot.status === "error";

          return (
            <li key={snapshot.version} className="flex items-start">
              {i > 0 ? (
                <span
                  className={`mt-[7px] h-px w-6 shrink-0 ${
                    isPast || isCurrent ? "bg-line-strong" : "bg-line"
                  }`}
                  aria-hidden
                />
              ) : null}
              <button
                type="button"
                onClick={() => onScrub(i)}
                className="group flex w-14 flex-col items-center gap-1"
                aria-current={isCurrent}
              >
                <span
                  className={[
                    "h-[9px] w-[9px] rounded-full border transition-colors",
                    failed
                      ? "border-bad"
                      : isCurrent
                        ? "border-accent"
                        : isPast
                          ? "border-good/60"
                          : "border-line-strong",
                    isCurrent
                      ? failed
                        ? "bg-bad"
                        : "bg-accent"
                      : isPast
                        ? "bg-good/50"
                        : "bg-transparent",
                  ].join(" ")}
                />
                <span
                  className={`truncate text-[9px] ${
                    isCurrent ? "text-ink" : "text-faint group-hover:text-dim"
                  }`}
                >
                  {snapshot.tick}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {!isLive ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-warn">
            Viewing history
          </span>
          <button
            type="button"
            onClick={onReturnToLive}
            className="rounded border border-line-strong px-2 py-1 text-[11px] text-dim hover:border-accent hover:text-accent"
          >
            Return to live
          </button>
        </div>
      ) : null}
    </div>
  );
}
