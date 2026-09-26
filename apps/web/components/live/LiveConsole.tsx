"use client";

import { useMemo } from "react";
import Link from "next/link";

import { getJson, usePolling } from "@/lib/usePolling";

import {
  ago,
  diffConfigs,
  type HarnessDoc,
  type Health,
  type LessonDoc,
  type QueueItemDoc,
  type RunDoc,
  type SubcircuitDoc,
} from "@/lib/live";

interface BoardSummary {
  board_id: string;
  spec_id?: string;
  kind?: string;
  harness_version?: number;
  passed?: boolean;
  failures?: unknown[];
  created_at?: string;
}

const POLL_MS = 2000;

const VERDICT_INK: Record<string, string> = {
  kept: "text-good",
  rejected: "text-bad",
  rolled_back: "text-warn",
  pending: "text-accent",
};

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[13px] text-ink">{title}</h2>
        {note ? <span className="text-[11px] text-faint">{note}</span> : null}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

interface LiveSnapshot {
  health: Health | null;
  runs: RunDoc[];
  versions: HarnessDoc[];
  lessons: LessonDoc[];
  subcircuits: SubcircuitDoc[];
  queue: QueueItemDoc[];
  boards: BoardSummary[];
}

async function loadLive(): Promise<LiveSnapshot> {
  const [h, r, v, m, q, b] = await Promise.all([
    getJson<Health>("/api/health"),
    getJson<{ runs?: RunDoc[] }>("/api/runs?limit=40"),
    getJson<{ versions?: HarnessDoc[] }>("/api/harness"),
    getJson<{ lessons?: LessonDoc[]; subcircuits?: SubcircuitDoc[] }>("/api/memory"),
    getJson<{ items?: QueueItemDoc[] }>("/api/queue"),
    getJson<{ boards?: BoardSummary[] }>("/api/boards"),
  ]);
  return {
    health: h,
    runs: r?.runs ?? [],
    versions: v?.versions ?? [],
    lessons: m?.lessons ?? [],
    subcircuits: m?.subcircuits ?? [],
    queue: q?.items ?? [],
    boards: b?.boards ?? [],
  };
}

export function LiveConsole() {
  const { data, paused, togglePause } = usePolling(loadLive, POLL_MS);

  const health = data?.health ?? null;
  const runs = data?.runs ?? [];
  const versions = useMemo(() => data?.versions ?? [], [data]);
  const lessons = data?.lessons ?? [];
  const subcircuits = data?.subcircuits ?? [];
  const queue = data?.queue ?? [];
  const boards = data?.boards ?? [];

  const connected = health?.connected === true;
  const byVersion = useMemo(
    () => new Map(versions.map((v) => [v.version, v])),
    [versions],
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
      <header className="flex h-12 shrink-0 items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <Link href="/" className="text-[15px] font-medium tracking-[0.08em] text-ink hover:text-accent">
            Ripple
          </Link>
          <nav className="flex items-baseline gap-3 text-[12px]">
            <Link href="/" className="text-faint hover:text-ink">
              Board
            </Link>
            <span className="text-ink">Live</span>
            <Link href="/harness" className="text-faint hover:text-ink">
              Harness
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-5 text-[12px]">
          <button type="button" onClick={togglePause} className="text-faint hover:text-ink">
            {paused ? "Resume" : "Pause"}
          </button>
          <span className="flex items-center gap-2">
            <span
              className={`h-[6px] w-[6px] rounded-full ${
                connected ? "bg-good" : "bg-bad"
              } ${connected && !paused ? "breathe" : ""}`}
              aria-hidden
            />
            <span className={connected ? "text-good" : "text-bad"}>
              {connected ? "Connected" : "Disconnected"}
            </span>
          </span>
        </div>
      </header>

      {health && !connected ? (
        <p className="mt-4 text-[13px] text-bad">
          {health.error ?? "Atlas unreachable"}
        </p>
      ) : null}

      {health?.counts ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-hair pb-4 text-[12px]">
          {Object.entries(health.counts).map(([name, n]) => (
            <span key={name} className="whitespace-nowrap">
              <span className="text-faint">{name.replace(/_/g, " ")} </span>
              <span className="font-mono text-dim [font-variant-numeric:tabular-nums]">{n}</span>
            </span>
          ))}
          {health.latency_ms !== undefined ? (
            <span className="whitespace-nowrap">
              <span className="text-faint">latency </span>
              <span className="font-mono text-dim">{health.latency_ms}ms</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <Section
        title="Harness evolution"
        note={`${versions.length} version${versions.length === 1 ? "" : "s"} · rejections kept on purpose`}
      >
        {versions.length === 0 ? (
          <p className="text-[12px] text-ghost">No config versions yet.</p>
        ) : (
          <ol className="space-y-3">
            {versions.map((v) => {
              const changes = diffConfigs(
                v.parent === null ? undefined : byVersion.get(v.parent),
                v,
              );
              return (
                <li key={v.version} className="border-l border-hair pl-3">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[13px] text-ink">v{v.version}</span>
                    {v.parent !== null ? (
                      <span className="font-mono text-[11px] text-ghost">from v{v.parent}</span>
                    ) : null}
                    <span className={`text-[12px] ${VERDICT_INK[v.verdict ?? ""] ?? "text-dim"}`}>
                      {v.verdict ?? "—"}
                    </span>
                    {v.scores?.checks_passed !== undefined ? (
                      <span className="font-mono text-[11px] text-faint">
                        checks {(v.scores.checks_passed * 100).toFixed(0)}%
                        {v.scores.attempts_per_board !== undefined
                          ? ` · ${v.scores.attempts_per_board.toFixed(1)} attempts`
                          : ""}
                        {v.scores.cost_per_board_usd !== undefined
                          ? ` · $${v.scores.cost_per_board_usd.toFixed(3)}`
                          : ""}
                      </span>
                    ) : null}
                  </div>

                  {v.rationale ? (
                    <p className="mt-1 max-w-3xl text-[12px] leading-snug text-dim">
                      {v.rationale}
                    </p>
                  ) : null}
                  {v.gate_note ? (
                    <p className="mt-1 max-w-3xl text-[12px] leading-snug text-faint">
                      Gate: {v.gate_note}
                    </p>
                  ) : null}

                  {changes.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {changes.map((c, i) => (
                        <li key={`${c.field}-${i}`} className="font-mono text-[11px]">
                          <span className="text-faint">{c.field} </span>
                          <span className="text-ghost">{c.from}</span>
                          <span className="text-ghost"> → </span>
                          <span className="text-dim">{c.to}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <Section
        title="Boards"
        note={boards.length ? "click to open the 3D view" : undefined}
      >
        {boards.length === 0 ? (
          <p className="text-[12px] text-ghost">No boards stored yet.</p>
        ) : (
          <ul className="space-y-1">
            {boards.slice(0, 10).map((b) => (
              <li key={b.board_id + String(b.created_at)}>
                <Link
                  href={`/boards/${b.board_id}`}
                  className="group flex items-baseline gap-3 text-[12px]"
                >
                  <span
                    className={`w-14 shrink-0 ${b.passed ? "text-good" : "text-bad"}`}
                  >
                    {b.passed ? "passed" : "failed"}
                  </span>
                  <span className="w-20 shrink-0 font-mono text-ghost">
                    {b.board_id.slice(0, 8)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-dim group-hover:text-accent">
                    {b.spec_id ?? "—"}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ghost">
                    {ago(b.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Runs" note={`${runs.length} most recent`}>
        {runs.length === 0 ? (
          <p className="text-[12px] text-ghost">No runs yet.</p>
        ) : (
          <ol className="space-y-1">
            {runs.map((r) => (
              <li key={r._id} className="flex items-baseline gap-3 text-[12px]">
                <span className={`w-14 shrink-0 ${r.passed ? "text-good" : "text-bad"}`}>
                  {r.passed ? "passed" : "failed"}
                </span>
                <span className="w-20 shrink-0 font-mono text-ghost">
                  {r.board_id.slice(0, 8)}
                </span>
                <span className="w-16 shrink-0 text-faint">{r.stage}</span>
                <span className="w-12 shrink-0 font-mono text-ghost">v{r.harness_version}</span>
                <span className="min-w-0 flex-1 truncate text-dim">
                  {r.failures?.length
                    ? `${r.failures.length} failure${r.failures.length === 1 ? "" : "s"}: ${r.failures[0].check} — ${r.failures[0].detail}`
                    : "—"}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ghost">{ago(r.ts)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {queue.length > 0 ? (
        <Section title="Work queue" note="long-horizon board">
          <ol className="space-y-1">
            {queue.map((i) => (
              <li key={i._id} className="flex items-baseline gap-3 text-[12px]">
                <span className="w-8 shrink-0 font-mono text-ghost">{i.step ?? "—"}</span>
                <span
                  className={`w-16 shrink-0 ${
                    i.stale
                      ? "text-warn"
                      : i.status === "done"
                        ? "text-good"
                        : i.status === "failed"
                          ? "text-bad"
                          : i.status === "running"
                            ? "text-accent"
                            : "text-faint"
                  }`}
                >
                  {i.stale ? "stalled" : (i.status ?? "—")}
                </span>
                <span className="min-w-0 flex-1 truncate text-dim">{i.title ?? i.key}</span>
                {i.stale ? (
                  <span className="shrink-0 text-[11px] text-warn">
                    worker died · will resume
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section
        title="Memory"
        note={`${lessons.length} lessons · ${subcircuits.length} subcircuits`}
      >
        <ul className="space-y-1.5">
          {lessons.slice(0, 8).map((l) => (
            <li key={l._id} className="text-[12px]">
              <span className="font-mono text-[11px] text-ghost">
                ×{l.times_helped ?? 0}{" "}
              </span>
              <span className="text-dim">{l.pattern}</span>
              <span className="text-ghost"> → </span>
              <span className="text-faint">{l.fix}</span>
            </li>
          ))}
        </ul>
        {subcircuits.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {subcircuits.map((s) => (
              <li key={s._id} className="text-[12px]">
                <span className="font-mono text-dim">{s.name}</span>
                <span className="text-ghost"> · reused {s.reuse_count ?? 0}×</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <footer className="mt-auto py-4 text-[11px] text-ghost">
        Read-only view of Atlas · polling every {POLL_MS / 1000}s
      </footer>
    </div>
  );
}
