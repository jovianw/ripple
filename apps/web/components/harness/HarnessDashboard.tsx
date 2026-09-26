"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import {
  activeActors,
  boardTotals,
  buildHarnessObservations,
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
import { HarnessTopology } from "./HarnessTopology";
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
  connected: boolean;
}

async function loadAll(): Promise<Snapshot> {
  const [health, runs, harness, memory, queue] = await Promise.all([
    getJson<{ connected?: boolean }>("/api/health"),
    getJson<{ runs?: RunDoc[] }>("/api/runs?limit=200"),
    getJson<{ versions?: HarnessDoc[] }>("/api/harness"),
    getJson<{ lessons?: LessonDoc[]; subcircuits?: SubcircuitDoc[] }>("/api/memory"),
    getJson<{ items?: QueueItemDoc[] }>("/api/queue"),
  ]);

  return {
    runs: runs?.runs ?? [],
    queue: queue?.items ?? [],
    versions: harness?.versions ?? [],
    lessons: memory?.lessons ?? [],
    subcircuits: memory?.subcircuits ?? [],
    connected: health?.connected === true,
  };
}

export function HarnessDashboard() {
  const { data, error, paused, togglePause } = usePolling(loadAll, POLL_MS);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Memoised so the `?? []` fallback does not produce a new array identity on
  // every render and invalidate everything downstream.
  const runs = useMemo(() => data?.runs ?? [], [data]);
  const queue = useMemo(() => data?.queue ?? [], [data]);
  const versions = useMemo(() => data?.versions ?? [], [data]);

  // Boards, most recently active first; the newest is the default focus.
  const boards = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of runs) {
      const prev = seen.get(r.board_id);
      if (!prev || r.ts > prev) seen.set(r.board_id, r.ts);
    }
    return [...seen.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .map(([id]) => id);
  }, [runs]);

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
  const active = useMemo(() => activeActors(observations), [observations]);
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
        <div className="flex items-baseline gap-4">
          <Link
            href="/"
            className="text-[15px] font-medium tracking-[0.08em] text-ink hover:text-accent"
          >
            Ripple
          </Link>
          <nav className="flex items-baseline gap-3 text-[12px]">
            <Link href="/" className="text-faint hover:text-ink">
              Board
            </Link>
            <Link href="/live" className="text-faint hover:text-ink">
              Live
            </Link>
            <span className="text-ink">Harness</span>
          </nav>
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
            <Head title="Topology" note="live state over known architecture" />
            <div className="mt-2.5">
              <HarnessTopology active={active} lastActor={latest?.actor ?? null} />
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
