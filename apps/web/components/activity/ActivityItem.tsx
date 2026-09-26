"use client";

import type { AgentName, SnapshotStatus } from "@/lib/types";

const AGENT_LABEL: Record<AgentName, string> = {
  planner: "Planner",
  coder: "Coder",
  critic: "Critic",
  checker: "Checker",
  meta: "Meta",
};

const MARK: Record<SnapshotStatus, { glyph: string; ink: string }> = {
  working: { glyph: "→", ink: "text-accent" },
  success: { glyph: "✓", ink: "text-good" },
  warning: { glyph: "↻", ink: "text-warn" },
  error: { glyph: "⚠", ink: "text-bad" },
};

export function ActivityItem({
  agent,
  message,
  status,
  active,
  /** Distance back from the newest event, used to fade older history. */
  age,
  /** Repeated agent headers are dropped so runs of one agent read as a block. */
  showAgent,
}: {
  agent: AgentName;
  message: string;
  status: SnapshotStatus;
  active: boolean;
  age: number;
  showAgent: boolean;
}) {
  const mark = MARK[status];
  // Recent history stays legible; older entries recede rather than disappear.
  const dim = active ? "" : age <= 2 ? "opacity-80" : age <= 4 ? "opacity-55" : "opacity-35";

  return (
    <li
      className={`rise border-l-2 pr-3 ${dim} ${
        active
          ? "border-l-accent bg-white/[0.04] py-2.5 pl-3"
          : "border-l-transparent py-1 pl-3"
      }`}
    >
      {showAgent ? (
        <div
          className={`font-mono text-[9px] uppercase tracking-[0.18em] ${
            active ? "text-dim" : "text-faint"
          } ${active ? "mb-1" : "mb-0.5"}`}
        >
          {AGENT_LABEL[agent]}
        </div>
      ) : null}

      <div className="flex gap-2">
        <span className={`shrink-0 ${mark.ink}`} aria-hidden>
          {mark.glyph}
        </span>
        <span
          className={`leading-snug ${
            active
              ? "text-[13px] text-ink"
              : status === "error"
                ? "text-[12px] text-bad"
                : "text-[12px] text-dim"
          }`}
        >
          {message}
        </span>
      </div>
    </li>
  );
}
