"use client";

import { useEffect, useRef } from "react";

import type { BuildSnapshot, PCBComponent } from "@/lib/types";
import { ActivityItem } from "./ActivityItem";

export function AgentActivity({
  history,
  selected,
  onClearSelection,
}: {
  history: BuildSnapshot[];
  selected: PCBComponent | null;
  onClearSelection: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the newest action as the build advances.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  return (
    <aside className="flex min-h-0 flex-col border-l border-line bg-panel">
      <header className="shrink-0 border-b border-line px-4 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">
          Agent activity
        </h2>
      </header>

      <div ref={scroller} className="slim-scroll min-h-0 flex-1 overflow-y-auto py-2">
        {history.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-faint">
            Idle. Run a build to see agent actions.
          </p>
        ) : (
          <ul>
            {history.map((snapshot, i) => (
              <ActivityItem
                key={snapshot.version}
                agent={snapshot.agent}
                message={snapshot.message}
                status={snapshot.status}
                active={i === history.length - 1}
              />
            ))}
          </ul>
        )}
      </div>

      {selected ? (
        <div className="shrink-0 border-t border-line bg-raised px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-mono text-sm text-ink">
                {selected.label}
                {selected.part ? (
                  <span className="text-dim"> — {selected.part}</span>
                ) : null}
              </div>
              <dl className="mt-1.5 space-y-0.5 text-[11px]">
                <div className="flex gap-2">
                  <dt className="text-faint">Status</dt>
                  <dd
                    className={
                      selected.status === "error"
                        ? "text-bad"
                        : selected.status === "repairing"
                          ? "text-warn"
                          : "text-good"
                    }
                  >
                    {selected.status === "error"
                      ? "Error"
                      : selected.status === "repairing"
                        ? "Repairing"
                        : "Healthy"}
                  </dd>
                </div>
                {selected.placedDuring ? (
                  <div className="flex gap-2">
                    <dt className="text-faint">Placed during</dt>
                    <dd className="text-dim capitalize">{selected.placedDuring}</dd>
                  </div>
                ) : null}
              </dl>
              {selected.note ? (
                <p className="mt-1.5 text-[11px] leading-snug text-bad">
                  {selected.note}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClearSelection}
              className="shrink-0 text-faint hover:text-ink"
              aria-label="Close details"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
