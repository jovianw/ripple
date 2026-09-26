"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NavTabs } from "@/components/NavTabs";

import { PCBViewport } from "@/components/pcb/PCBViewport";
import { Telemetry } from "@/components/build/Telemetry";
import { ComponentInspector } from "@/components/pcb/ComponentInspector";
import { ago } from "@/lib/live";
import { EMPTY_PCB, type PCBComponent, type PCBState } from "@/lib/types";

interface BoardMeta {
  board_id: string;
  spec_id?: string;
  kind?: string;
  harness_version?: number;
  passed: boolean | null;
  failures: { check: string; detail: string }[];
  created_at?: string;
}

interface BoardPayload {
  board: BoardMeta;
  pcb: PCBState;
  errors: { message: string; componentId?: string }[];
  viaCount: number;
}

const NO_CHANGES: ReadonlySet<string> = new Set();

/**
 * A real board from Atlas, drawn by the same scene the scripted demo uses.
 * Nothing about the renderer is demo-specific — it takes a PCBState, and the
 * adapter turns Circuit JSON into one.
 */
export function RealBoardView({ boardId }: { boardId: string }) {
  const [data, setData] = useState<BoardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PCBComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        setData(json as BoardPayload);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const pcb = data?.pcb ?? EMPTY_PCB;
  const meta = data?.board;
  const failed = meta?.passed === false;

  const metrics = {
    components: pcb.components.length,
    nets: pcb.traces.length,
    drcErrors: data?.errors.length ?? 0,
    boardWidthMm: pcb.board.widthMm,
    boardHeightMm: pcb.board.heightMm,
    bomUsd: 0,
  };

  const selectedLive = selected
    ? (pcb.components.find((c) => c.id === selected.id) ?? null)
    : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-void">
      <header className="flex h-12 shrink-0 items-center justify-between px-6">
        <div className="flex items-center gap-5">
          <Link
            href="/system"
            className="text-[15px] font-medium tracking-[0.08em] text-ink hover:text-accent"
          >
            Ripple
          </Link>
          <NavTabs active="board" />
          <span className="text-[12px] text-faint">
            {meta?.spec_id ?? boardId}
          </span>
        </div>
        <div className="flex items-center gap-5 text-[12px]">
          {meta?.harness_version !== undefined ? (
            <span className="text-faint">
              Harness <span className="font-mono text-dim">{String(meta.harness_version).padStart(2, "0")}</span>
            </span>
          ) : null}
          {meta ? (
            <span className="flex items-center gap-2">
              <span
                className={`h-[6px] w-[6px] rounded-full ${
                  meta.passed ? "bg-good" : "bg-bad"
                }`}
                aria-hidden
              />
              <span className={meta.passed ? "text-good" : "text-bad"}>
                {meta.passed ? "Passed" : "Failed"}
              </span>
            </span>
          ) : null}
        </div>
      </header>

      {/* Explicit min-height: a flex child can measure 0 before layout
          settles, and the canvas caches that first measurement. */}
      <div className="relative min-h-[320px] flex-1">
        <div className="absolute inset-0">
          <PCBViewport
            pcb={pcb}
            isRunning={false}
            selectedId={selectedLive?.id ?? null}
            changedIds={NO_CHANGES}
            snapshotVersion={-1}
            focusId={null}
            complete={meta?.passed === true}
            onSelect={setSelected}
          />
        </div>

        <div className="pointer-events-none absolute left-6 top-5 max-w-[26rem]">
          {error ? (
            <>
              <div className="text-[20px] font-medium leading-tight text-bad">
                Could not load board
              </div>
              <div className="mt-1.5 text-[12px] text-faint">{error}</div>
            </>
          ) : !data ? (
            <div className="text-[20px] font-medium leading-tight text-dim">
              Loading board…
            </div>
          ) : (
            <>
              <div
                className={`text-[20px] font-medium leading-tight ${
                  failed ? "text-bad" : "text-ink"
                }`}
              >
                {failed
                  ? `${meta?.failures.length ?? 0} hidden check${
                      meta?.failures.length === 1 ? "" : "s"
                    } failed`
                  : "All hidden checks passed"}
              </div>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-2 text-[12px] text-faint">
                <span className="font-mono">{meta?.board_id.slice(0, 8)}</span>
                <span className="text-ghost">·</span>
                <span>{meta?.kind}</span>
                <span className="text-ghost">·</span>
                <span>{ago(meta?.created_at)}</span>
              </div>

              {failed && meta ? (
                <ul className="mt-3 space-y-1">
                  {meta.failures.slice(0, 4).map((f, i) => (
                    <li key={`${f.check}-${i}`} className="text-[12px] leading-snug">
                      <span className="font-mono text-bad">{f.check}</span>
                      <span className="text-faint"> — {f.detail}</span>
                    </li>
                  ))}
                  {meta.failures.length > 4 ? (
                    <li className="text-[11px] text-ghost">
                      +{meta.failures.length - 4} more
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </>
          )}
        </div>

        {selectedLive ? (
          <div className="absolute bottom-5 left-6">
            <ComponentInspector
              component={selectedLive}
              onClose={() => setSelected(null)}
            />
          </div>
        ) : null}

        {data ? (
          <div className="pointer-events-none absolute bottom-5 right-6">
            <Telemetry metrics={metrics} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
