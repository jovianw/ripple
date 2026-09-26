"use client";

import Link from "next/link";

import { ago, type BoardSummary, type Health, type LessonDoc, type SubcircuitDoc } from "@/lib/live";
import { getJson, usePolling } from "@/lib/usePolling";

const POLL_MS = 2000;

interface SystemSnapshot {
  health: Health | null;
  boards: BoardSummary[];
  lessons: LessonDoc[];
  subcircuits: SubcircuitDoc[];
}

async function loadSystem(): Promise<SystemSnapshot> {
  const [health, boards, memory] = await Promise.all([
    getJson<Health>("/api/health"),
    getJson<{ boards?: BoardSummary[] }>("/api/boards"),
    getJson<{ lessons?: LessonDoc[]; subcircuits?: SubcircuitDoc[] }>("/api/memory"),
  ]);
  return {
    health,
    boards: boards?.boards ?? [],
    lessons: memory?.lessons ?? [],
    subcircuits: memory?.subcircuits ?? [],
  };
}

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

/**
 * The system index: is Atlas reachable, what is stored, and what has the
 * harness learned. Deliberately *not* an execution view — runs, the queue and
 * config evolution all live on /harness, which interprets them rather than
 * listing them.
 */
export function SystemConsole() {
  const { data, paused, togglePause } = usePolling(loadSystem, POLL_MS);

  const health = data?.health ?? null;
  const boards = data?.boards ?? [];
  const lessons = data?.lessons ?? [];
  const subcircuits = data?.subcircuits ?? [];
  const connected = health?.connected === true;

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6">
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
            <span className="text-ink">System</span>
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
              <span className="font-mono text-dim [font-variant-numeric:tabular-nums]">
                {n}
              </span>
            </span>
          ))}
          {health.database ? (
            <span className="whitespace-nowrap">
              <span className="text-faint">db </span>
              <span className="font-mono text-dim">{health.database}</span>
            </span>
          ) : null}
          {health.latency_ms !== undefined ? (
            <span className="whitespace-nowrap">
              <span className="text-faint">latency </span>
              <span className="font-mono text-dim">{health.latency_ms}ms</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <Section
        title="Boards"
        note={boards.length ? "click to open the 3D view" : undefined}
      >
        {boards.length === 0 ? (
          <p className="text-[12px] text-ghost">No boards stored yet.</p>
        ) : (
          <ul className="space-y-1">
            {boards.slice(0, 12).map((b) => (
              <li key={b.board_id + String(b.created_at)}>
                <Link
                  href={`/boards/${b.board_id}`}
                  className="group flex items-baseline gap-3 text-[12px]"
                >
                  <span className={`w-14 shrink-0 ${b.passed ? "text-good" : "text-bad"}`}>
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

      <Section title="Lessons" note={`${lessons.length} active`}>
        {lessons.length === 0 ? (
          <p className="text-[12px] text-ghost">Nothing learned yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {lessons.map((l) => (
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
        )}
      </Section>

      <Section title="Subcircuit library" note={`${subcircuits.length} verified`}>
        {subcircuits.length === 0 ? (
          <p className="text-[12px] text-ghost">No reusable blocks yet.</p>
        ) : (
          <ul className="space-y-1">
            {subcircuits.map((s) => (
              <li key={s._id} className="text-[12px]">
                <span className="font-mono text-dim">{s.name}</span>
                <span className="text-ghost"> · reused {s.reuse_count ?? 0}×</span>
                {s.description ? (
                  <span className="text-faint"> · {s.description}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="mt-auto py-4 text-[11px] text-ghost">
        Read-only view of Atlas · polling every {POLL_MS / 1000}s · execution
        detail lives on{" "}
        <Link href="/harness" className="text-faint hover:text-ink">
          Harness
        </Link>
        .
      </footer>
    </div>
  );
}
