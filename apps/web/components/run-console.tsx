"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { RunFeed } from "@/components/run-feed";
import { SpecInput } from "@/components/spec-input";
import { StatTile } from "@/components/stat-tile";
import {
  CURRENT_CONFIG,
  CURRENT_SPEC,
  FEED_EVENTS,
  summarize,
} from "@/lib/fixtures";

// Replays the fixture feed on its own timings. When Atlas is live this component
// keeps its shape: the events arrive from a change stream (local) or a poll
// (Vercel) instead of from setTimeout. DESIGN.md §3.
export function RunConsole() {
  const [spec, setSpec] = useState(CURRENT_SPEC.text);
  const [visibleCount, setVisibleCount] = useState(0);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(() => {
    clearTimers();
    setVisibleCount(0);
    setRunning(true);

    FEED_EVENTS.forEach((event, index) => {
      timers.current.push(
        setTimeout(() => {
          setVisibleCount(index + 1);
          if (index === FEED_EVENTS.length - 1) setRunning(false);
        }, event.at_ms),
      );
    });
  }, [clearTimers]);

  // ?autoplay=1 starts a run on load — used for the demo video and screenshots.
  // Read off window rather than useSearchParams so the page stays static, and
  // kick off from a timer so the run begins after paint rather than mid-effect.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("autoplay") !== "1") return;
    const kickoff = setTimeout(start, 0);
    return () => clearTimeout(kickoff);
  }, [start]);

  const visible = FEED_EVENTS.slice(0, visibleCount);
  const stats = summarize(visible);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Hidden checks passed"
          value={`${stats.checksPassed}/${stats.totalChecks}`}
          note={stats.settled ? "All checks green" : "Graded on checks it can't see"}
          status={stats.settled ? "good" : stats.attempts > 0 ? "critical" : "neutral"}
        />
        <StatTile
          label="Attempts"
          value={String(stats.attempts)}
          note={`Repair budget ${stats.repairBudget}`}
        />
        <StatTile
          label="Cost this board"
          value={`$${stats.costUsd.toFixed(3)}`}
          note="Cheap model coding, strong model critiquing"
        />
        <StatTile
          label="Harness version"
          value={`v${stats.harnessVersion}`}
          note={`${CURRENT_CONFIG.verdict} · parent v${CURRENT_CONFIG.parent}`}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <SpecInput
          value={spec}
          onChange={setSpec}
          onSubmit={start}
          running={running}
        />
        <RunFeed events={visible} running={running} />
      </div>
    </div>
  );
}
