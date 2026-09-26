"use client";

import { useEffect, useRef } from "react";

import type { AgentName, BuildSnapshot } from "@/lib/types";

const AGENT_LABEL: Record<AgentName, string> = {
  planner: "Planner",
  coder: "Coder",
  critic: "Critic",
  checker: "Checker",
  meta: "Meta",
};

/**
 * The run as an execution trace rather than a feed of cards.
 *
 * A single hairline spine runs the height of the column; each step is a node on
 * it. Weight and opacity carry recency, so the eye lands on the current step
 * without a highlight box. Failures and their repairs are tinted so the causal
 * pair reads as one episode.
 */
export function ExecutionTrace({ history }: { history: BuildSnapshot[] }) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  const last = history.length - 1;

  if (history.length === 0) {
    return (
      <div className="flex h-full items-start px-6 pt-8">
        <p className="text-[13px] text-ghost">Awaiting specification.</p>
      </div>
    );
  }

  return (
    <div ref={scroller} className="slim-scroll h-full overflow-y-auto px-6 py-5">
      <ol className="relative">
        {/* The spine. Sits behind the nodes and stops at the last one. */}
        <span
          className="absolute left-[3px] top-1 w-px bg-hair"
          style={{ height: "calc(100% - 1.5rem)" }}
          aria-hidden
        />

        {history.map((snapshot, i) => {
          const age = last - i;
          const active = i === last;
          const failed = snapshot.status === "error";
          const repairing = snapshot.status === "warning";
          const passed = snapshot.stage === "complete";

          const opacity = active ? 1 : age <= 1 ? 0.72 : age <= 3 ? 0.5 : 0.3;

          const dot = failed
            ? "bg-bad"
            : repairing
              ? "bg-warn"
              : active
                ? passed
                  ? "bg-good"
                  : "bg-accent"
                : "bg-ghost";

          const primaryInk = failed
            ? "text-bad"
            : repairing
              ? "text-warn"
              : active
                ? "text-ink"
                : "text-dim";

          return (
            <li
              key={snapshot.version}
              className="trace-in relative pl-5"
              // Failures break the vertical rhythm; the eye catches the gap
              // before it reads the words.
              style={{
                opacity,
                marginTop: i === 0 ? 0 : failed ? "1.4rem" : "0.85rem",
              }}
            >
              <span
                className={`absolute left-0 top-[6px] h-[7px] w-[7px] rounded-full ${dot} ${
                  active && !passed ? "breathe" : ""
                }`}
                aria-hidden
              />

              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-ghost">
                  {String(snapshot.version + 1).padStart(2, "0")}
                </span>
                <span className="text-[11px] text-faint">
                  {AGENT_LABEL[snapshot.agent]}
                </span>
              </div>

              <div
                className={`mt-0.5 leading-snug ${primaryInk} ${
                  active ? "text-[14px]" : "text-[13px]"
                }`}
              >
                {snapshot.message}
              </div>

              {snapshot.summary?.[1] ? (
                <div className="mt-0.5 font-mono text-[11px] text-faint">
                  {snapshot.summary[1]}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
