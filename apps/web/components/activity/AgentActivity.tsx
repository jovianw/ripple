"use client";

import { useEffect, useRef } from "react";

import type { BuildSnapshot } from "@/lib/types";
import { ActivityItem } from "./ActivityItem";

export function AgentActivity({ history }: { history: BuildSnapshot[] }) {
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the newest action as the build advances.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  const last = history.length - 1;

  return (
    <aside className="flex min-h-0 flex-col border-l border-line bg-panel">
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-dim">
          Agent activity
        </h2>
        <span className="font-mono text-[10px] text-faint">
          {history.length > 0 ? `${history.length}` : ""}
        </span>
      </header>

      <div
        ref={scroller}
        className="slim-scroll min-h-0 flex-1 overflow-y-auto py-2"
      >
        {history.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-faint">
            Idle. Run a build to see agent actions.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {history.map((snapshot, i) => (
              <ActivityItem
                key={snapshot.version}
                agent={snapshot.agent}
                message={snapshot.message}
                status={snapshot.status}
                active={i === last}
                age={last - i}
                showAgent={i === 0 || history[i - 1].agent !== snapshot.agent}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
