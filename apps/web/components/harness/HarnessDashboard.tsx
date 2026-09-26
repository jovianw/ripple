"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { NavTabs } from "@/components/NavTabs";

import {
  boardTotals,
  buildHarnessObservations,
  LOOP_STAGE_MAP,
} from "@/lib/harness-observability";
import type {
  HarnessDoc,
  LessonDoc,
  QueueItemDoc,
  RunDoc,
  SubcircuitDoc,
} from "@/lib/live";
import { getJson, usePolling } from "@/lib/usePolling";

import { CurrentExecution } from "./CurrentExecution";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { HarnessEvolution } from "./HarnessEvolution";
import { DesignLoop } from "./DesignLoop";
import { HarnessVersionView } from "./HarnessVersionView";
import { ObservationInspector } from "./ObservationInspector";
import { QueueView } from "./QueueView";
import { RunTelemetry } from "./RunTelemetry";
import { Head } from "./primitives";

const POLL_MS = 2000;

interface Snapshot {
  runs: RunDoc[];
  queue: QueueItemDoc[];
  versions: HarnessDoc[];
  lessons: LessonDoc[];
  subcircuits: SubcircuitDoc[];
  /** Every board's id, most recently created first — from /api/boards, independent of which board's runs we scoped below. */
  boardIds: string[];
  connected: boolean;
}

/**
 * `boardId` scopes the runs/queue fetch server-side when given (a specific board someone is watching), instead of
 * pulling the last 200 runs system-wide and filtering client-side: with several people's boards interleaving, that
 * global window can push a board's own early runs out entirely before this ever sees them. The board list still
 * comes from the small, always-unscoped /api/boards, so the picker below can offer any board regardless of scope.
 */
async function loadAll(boardId: string | null): Promise<Snapshot> {
  const scope = boardId ? `board_id=${encodeURIComponent(boardId)}&` : "";
  const [health, runs, harness, memory, queue, boards] = await Promise.all([
    getJson<{ connected?: boolean }>("/api/health"),
    getJson<{ runs?: RunDoc[] }>(`/api/runs?${scope}limit=200`),
    getJson<{ versions?: HarnessDoc[] }>("/api/harness"),
    getJson<{ lessons?: LessonDoc[]; subcircuits?: SubcircuitDoc[] }>("/api/memory"),
    getJson<{ items?: QueueItemDoc[] }>(`/api/queue${boardId ? `?${scope}` : ""}`),
    getJson<{ boards?: { board_id: string }[] }>("/api/boards"),
  ]);

  return {
    runs: runs?.runs ?? [],
    queue: queue?.items ?? [],
    versions: harness?.versions ?? [],
    lessons: memory?.lessons ?? [],
    subcircuits: memory?.subcircuits ?? [],
    boardIds: (boards?.boards ?? []).map((b) => b.board_id),
    connected: health?.connected === true,
  };
}

export function HarnessDashboard({ sessionBoardId = null }: { sessionBoardId?: string | null } = {}) {
  // Starts on the board this session actually submitted (from the URL), so opening /harness right after a build
  // shows that build's own activity — not whichever board happens to be most recently active system-wide, which
  // could easily be someone else's once more than one person is using this at once.
  const [boardId, setBoardId] = useState<string | null>(sessionBoardId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const load = useCallback(() => loadAll(boardId), [boardId]);
  const { data, error, paused, togglePause } = usePolling(load, POLL_MS);

  // Memoised so the `?? []` fallback does not produce a new array identity on
  // every render and invalidate everything downstream.
  const runs = useMemo(() => data?.runs ?? [], [data]);
  const queue = useMemo(() => data?.queue ?? [], [data]);
  const versions = useMemo(() => data?.versions ?? [], [data]);
  const boards = useMemo(() => data?.boardIds ?? [], [data]);

  // Falls back to the most recently created board only when nobody asked for a specific one.
  const activeBoard = boardId ?? boards[0] ?? null;

  const boardRuns = useMemo(
    () => runs.filter((r) => r.board_id === activeBoard),
    [runs, activeBoard],
  );

  const boardQueue = useMemo(
    () =>
      queue.filter(
        (q) => !activeBoard || (q as { board_id?: string }).board_id === activeBoard,
      ),
    [queue, activeBoard],
  );

  const observations = useMemo(
    () => buildHarnessObservations({ runs: boardRuns, queue: boardQueue }),
    [boardRuns, boardQueue],
  );

  const latest = observations[0] ?? null;

  // Where the loop is now, and the step before it, so the connector between
  // them can show the direction of travel.
  const runObservations = useMemo(
    () => observations.filter((o) => o.source === "run" && o.stage),
    [observations],
  );
  const activeLoopStage = runObservations[0]?.stage
    ? (LOOP_STAGE_MAP[runObservations[0].stage] ?? null)
    : null;
  const previousLoopStage = runObservations[1]?.stage
    ? (LOOP_STAGE_MAP[runObservations[1].stage] ?? null)
    : null;
  const loopFailing = runObservations[0]?.status === "failure";
  const totals = useMemo(() => boardTotals(boardRuns), [boardRuns]);

  const runningItem = boardQueue.find((q) => q.status === "running") ?? null;

  // The config the board's newest run was produced under.
  const versionForBoard = useMemo(() => {
    const v = latest?.harnessVersion;
    return versions.find((x) => x.version === v) ?? versions.at(-1) ?? null;
  }, [latest, versions]);

  const selected =
    observations.find((o) => o.id === selectedId) ?? latest ?? null;

  const connected = data?.connected === true;

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6">
      <header className="flex h-12 shrink-0 items-center justify-between">
        <div className="flex items-center gap-5">
          <Link
            href="/"
            className="text-[15px] font-medium tracking-[0.08em] text-ink hover:text-accent"
          >
            Ripple
          </Link>
          <NavTabs active="harness" />
        </div>

        <div className="flex items-center gap-5 text-[12px]">
          {boards.length > 1 ? (
            <label className="flex items-center gap-2">
              <span className="text-faint">board</span>
              <select
                value={activeBoard ?? ""}
                onChange={(e) => {
                  setBoardId(e.target.value);
                  setSelectedId(null);
                }}
                className="border-b border-hair bg-transparent py-0.5 font-mono text-[11px] text-dim focus:border-accent focus:outline-none"
              >
                {boards.map((b) => (
                  <option key={b} value={b} className="bg-void">
                    {b.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button type="button" onClick={togglePause} className="text-faint hover:text-ink">
            {paused ? "Resume" : "Pause"}
          </button>

          <span className="flex items-center gap-2">
            <span
              className={`h-[6px] w-[6px] rounded-full ${connected ? "bg-good" : "bg-bad"} ${
                connected && !paused ? "breathe" : ""
              }`}
              aria-hidden
            />
            <span className={connected ? "text-good" : "text-bad"}>
              {connected ? "Connected" : "Disconnected"}
            </span>
          </span>
        </div>
      </header>

      {error ? <p className="text-[12px] text-bad">{error}</p> : null}

      <div className="grid min-h-0 flex-1 gap-8 border-t border-hair pt-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-7">
          <section>
            <CurrentExecution
              latest={latest}
              running={runningItem}
              harnessVersion={latest?.harnessVersion ?? null}
            />
            <div className="mt-4">
              <RunTelemetry
                tokens={totals.tokens}
                costUsd={totals.costUsd}
                modelCalls={totals.modelCalls}
                attempts={totals.attempts}
              />
            </div>
          </section>

          <section>
            <Head title="Design loop" note="live stage" />
            <div className="mt-2.5">
              <DesignLoop
                active={activeLoopStage}
                previous={previousLoopStage}
                failed={loopFailing}
              />
            </div>
          </section>

          <section>
            <Head
              title="Work queue"
              note={boardQueue.length ? undefined : "no entries for this board"}
            />
            <div className="mt-2.5">
              <QueueView items={boardQueue} />
            </div>
          </section>

          <section>
            <Head title="Execution timeline" note={`${observations.length} records`} />
            <div className="mt-2.5">
              <ExecutionTimeline
                observations={observations}
                selectedId={selected?.id ?? null}
                onSelect={(o) => setSelectedId(o.id)}
              />
            </div>
          </section>

          <section>
            <Head
              title="Harness configuration"
              note={versionForBoard ? `v${String(versionForBoard.version).padStart(2, "0")}` : undefined}
            />
            <div className="mt-2.5">
              <HarnessVersionView version={versionForBoard} />
            </div>
          </section>

          <section className="pb-8">
            <Head title="Harness evolution" note="rejections kept on purpose" />
            <div className="mt-2.5">
              <HarnessEvolution versions={versions} />
            </div>
          </section>
        </div>

        <aside className="lg:border-l lg:border-hair lg:pl-6">
          <Head title="Inspector" />
          <div className="mt-2.5">
            <ObservationInspector
              observation={selected}
              lessons={data?.lessons ?? []}
              subcircuits={data?.subcircuits ?? []}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
