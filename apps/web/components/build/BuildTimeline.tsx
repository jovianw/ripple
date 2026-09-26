"use client";

import { useState } from "react";

import type { BuildSnapshot } from "@/lib/types";

/** Each node is a real snapshot you can jump to, with what changed on hover. */
export function BuildTimeline({
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
  const [hovered, setHovered] = useState<number | null>(null);

  if (snapshots.length === 0) return null;

  const tip = hovered !== null ? snapshots[hovered] : null;

  return (
    <div className="relative flex items-center gap-4 px-4 py-2">
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-faint">
        History
      </span>

      <ol className="slim-scroll flex flex-1 items-start gap-0 overflow-x-auto">
        {snapshots.map((snapshot, i) => {
          const isCurrent = i === currentIndex;
          const isPast = i < currentIndex;
          const failed = snapshot.status === "error";
          const warn = snapshot.status === "warning";

          const dot = failed
            ? "border-bad bg-bad"
            : isCurrent
              ? warn
                ? "border-warn bg-warn"
                : "border-accent bg-accent"
              : isPast
                ? warn
                  ? "border-warn/50 bg-warn/40"
                  : "border-good/50 bg-good/40"
                : "border-line-strong bg-transparent";

          return (
            <li key={snapshot.version} className="flex items-start">
              {i > 0 ? (
                <span
                  className={`mt-[7px] h-px w-5 shrink-0 ${
                    isPast || isCurrent ? "bg-line-strong" : "bg-line"
                  }`}
                  aria-hidden
                />
              ) : null}
              <button
                type="button"
                onClick={() => onScrub(i)}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                className="group flex w-[3.4rem] flex-col items-center gap-1"
                aria-current={isCurrent}
              >
                <span
                  className={`h-[9px] w-[9px] rounded-full border transition-colors ${dot} ${
                    isCurrent ? "ring-2 ring-white/15" : ""
                  }`}
                />
                <span
                  className={`truncate text-[9px] ${
                    isCurrent
                      ? "text-ink"
                      : "text-faint group-hover:text-dim"
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
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-warn">
            History · {currentIndex + 1}/{totalCount}
          </span>
          <button
            type="button"
            onClick={onReturnToLive}
            className="rounded-sm border border-warn/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-warn hover:bg-warn/10"
          >
            Return to live
          </button>
        </div>
      ) : null}

      {/* Hover summary: what this snapshot changed. Small, not a modal. */}
      {tip?.summary ? (
        <div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-16 z-20 rounded-sm border border-line bg-panel/95 px-2.5 py-1.5 backdrop-blur-sm">
          <div
            className={`font-mono text-[9px] uppercase tracking-[0.16em] ${
              tip.status === "error"
                ? "text-bad"
                : tip.status === "warning"
                  ? "text-warn"
                  : "text-dim"
            }`}
          >
            {tip.summary[0]}
          </div>
          {tip.summary[1] ? (
            <div className="mt-0.5 whitespace-nowrap text-[11px] text-ink">
              {tip.summary[1]}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
