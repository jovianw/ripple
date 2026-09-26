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
  warning: { glyph: "⚠", ink: "text-warn" },
  error: { glyph: "⚠", ink: "text-bad" },
};

export function ActivityItem({
  agent,
  message,
  status,
  active,
}: {
  agent: AgentName;
  message: string;
  status: SnapshotStatus;
  active: boolean;
}) {
  const mark = MARK[status];

  return (
    <li
      className={`rise border-l-2 py-2 pl-3 pr-2 ${
        active ? "border-accent bg-white/[0.03]" : "border-transparent"
      }`}
    >
      <div
        className={`font-mono text-[10px] uppercase tracking-wider ${
          active ? "text-dim" : "text-faint"
        }`}
      >
        {AGENT_LABEL[agent]}
      </div>
      <div className="mt-0.5 flex gap-2">
        <span className={`${mark.ink} ${active ? "" : "opacity-60"}`} aria-hidden>
          {mark.glyph}
        </span>
        <span
          className={`text-[13px] leading-snug ${
            active ? "text-ink" : "text-dim"
          }`}
        >
          {message}
        </span>
      </div>
    </li>
  );
}
