"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ExecutionTrace } from "@/components/activity/ExecutionTrace";
import { HistoryGraph } from "@/components/build/HistoryGraph";
import { SpecificationBar } from "@/components/build/SpecificationBar";
import { StageRibbon } from "@/components/build/StageRibbon";
import { Telemetry } from "@/components/build/Telemetry";
import { ComponentInspector } from "@/components/pcb/ComponentInspector";
import { PCBViewport } from "@/components/pcb/PCBViewport";
import type { RippleEvent } from "@/components/pcb/RippleField";
import { WorldHud } from "@/components/pcb/WorldHud";
import { DEFAULT_PROMPT, DEMO_SNAPSHOTS } from "@/lib/demoSnapshots";
import { deriveMetrics } from "@/lib/metrics";
import { diffPCBStates } from "@/lib/pcbDiff";
import { EMPTY_PCB, type PCBComponent } from "@/lib/types";

// Where the backend will plug in: today the snapshots come from a scripted
// array, later from an API or change stream. Nothing below this component
// knows the difference — it all takes BuildSnapshot props.
const SNAPSHOTS = DEMO_SNAPSHOTS;

/** One canonical status for the whole system; details live elsewhere. */
function systemStatus(args: {
  started: boolean;
  running: boolean;
  failing: boolean;
  repairing: boolean;
  complete: boolean;
  checking: boolean;
}): { label: string; ink: string; dot: string; pulse: boolean } {
  if (args.failing)
    return { label: "Failed", ink: "text-bad", dot: "bg-bad", pulse: false };
  if (args.repairing)
    return { label: "Repairing", ink: "text-warn", dot: "bg-warn", pulse: true };
  if (args.complete)
    return { label: "Passed", ink: "text-good", dot: "bg-good", pulse: false };
  if (args.checking)
    return { label: "Checking", ink: "text-accent", dot: "bg-accent", pulse: true };
  if (args.running)
    return { label: "Building", ink: "text-accent", dot: "bg-accent", pulse: true };
  return { label: "Idle", ink: "text-faint", dot: "bg-ghost", pulse: false };
}

export function RippleDashboard() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [revealed, setRevealed] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isLive, setIsLive] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [selected, setSelected] = useState<PCBComponent | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Timers read liveness from a ref so scrubbing never has to cancel the run:
  // the build keeps completing in the background while the viewer looks back.
  const liveRef = useRef(true);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const runDemo = useCallback(() => {
    clearTimers();
    liveRef.current = true;
    setIsLive(true);
    setSelected(null);
    setIsRunning(true);
    setRevealed(1);
    setCurrentIndex(0);

    let at = 0;
    for (let i = 1; i < SNAPSHOTS.length; i++) {
      at += SNAPSHOTS[i - 1].delay ?? 800;
      const index = i;
      timers.current.push(
        setTimeout(() => {
          setRevealed(index + 1);
          if (liveRef.current) setCurrentIndex(index);
          if (index === SNAPSHOTS.length - 1) setIsRunning(false);
        }, at),
      );
    }
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    liveRef.current = true;
    setIsLive(true);
    setIsRunning(false);
    setRevealed(0);
    setCurrentIndex(-1);
    setSelected(null);
  }, [clearTimers]);

  const scrubTo = useCallback((index: number) => {
    liveRef.current = false;
    setIsLive(false);
    setCurrentIndex(index);
    setSelected(null);
  }, []);

  const returnToLive = useCallback(() => {
    liveRef.current = true;
    setIsLive(true);
    setCurrentIndex(revealed - 1);
    setSelected(null);
  }, [revealed]);

  // ?autoplay=1 runs the build on load — used for recording the demo video and
  // for headless screenshots. Kicked off from a timer so no state is set
  // synchronously inside the effect.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("autoplay") !== "1") return;
    const kickoff = setTimeout(runDemo, 400);
    return () => clearTimeout(kickoff);
  }, [runDemo]);

  const current = currentIndex >= 0 ? SNAPSHOTS[currentIndex] : null;
  const pcb = current?.pcb ?? EMPTY_PCB;

  const diff = useMemo(() => {
    const previous =
      currentIndex > 0 ? SNAPSHOTS[currentIndex - 1].pcb : EMPTY_PCB;
    return diffPCBStates(previous, pcb);
  }, [currentIndex, pcb]);

  // Added parts animate by mounting; *changed* parts keep the same mesh, so the
  // diff is what tells the scene to re-highlight them.
  const changedIds = useMemo(
    () => new Set(diff.changedComponents.map((c) => c.id)),
    [diff],
  );

  // Change propagation: one ring per meaningful edit, keyed by snapshot so the
  // scene admits each exactly once.
  const ripples = useMemo<RippleEvent[]>(() => {
    if (!current) return [];
    const version = current.version;
    const out: RippleEvent[] = [];

    for (const c of diff.addedComponents) {
      out.push({
        id: `${version}:add:${c.id}`,
        x: c.position.x,
        y: c.position.y,
        tone: c.placedDuring === "repair" ? "repair" : "place",
      });
    }
    for (const c of diff.changedComponents) {
      if (c.status !== "error" && c.status !== "repairing") continue;
      out.push({
        id: `${version}:${c.status}:${c.id}`,
        x: c.position.x,
        y: c.position.y,
        tone: c.status === "error" ? "error" : "repair",
      });
    }
    return out;
  }, [current, diff]);

  const history = useMemo(
    () => SNAPSHOTS.slice(0, isLive ? revealed : currentIndex + 1),
    [isLive, revealed, currentIndex],
  );

  const revealedSnapshots = useMemo(
    () => SNAPSHOTS.slice(0, revealed),
    [revealed],
  );

  const metrics = useMemo(() => deriveMetrics(pcb, current), [pcb, current]);

  const faultId =
    pcb.components.find(
      (c) => c.status === "error" || c.status === "repairing",
    )?.id ?? null;

  const selectedLive = selected
    ? (pcb.components.find((c) => c.id === selected.id) ?? null)
    : null;

  const complete = current?.stage === "complete";
  const failing = current?.status === "error";
  const repairing = current?.stage === "repair" && !complete;
  const checkFailed = history.some((s) => s.status === "error");
  const progress = revealed === 0 ? 0 : (currentIndex + 1) / SNAPSHOTS.length;

  const status = systemStatus({
    started: revealed > 0,
    running: isRunning,
    failing,
    repairing,
    complete,
    checking: current?.stage === "checking" && !failing,
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-void">
      {/* Product status bar. Two facts on the left, two on the right. */}
      <header className="flex h-12 shrink-0 items-center justify-between px-6">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-medium tracking-[0.08em] text-ink">
            Ripple
          </span>
          <span className="text-[12px] text-ghost">PCB synthesis</span>
        </div>
        <div className="flex items-center gap-5">
          <span className="text-[12px] text-faint">
            Harness <span className="font-mono text-dim">01</span>
          </span>
          <span className="flex items-center gap-2">
            <span
              className={`h-[6px] w-[6px] rounded-full ${status.dot} ${
                status.pulse ? "breathe" : ""
              }`}
              aria-hidden
            />
            <span className={`text-[12px] ${status.ink}`}>{status.label}</span>
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] lg:grid-cols-[minmax(0,1fr)_310px] lg:grid-rows-1">
        {/* The world. Instrumentation floats over it rather than beside it. */}
        <section className="relative min-h-[260px]">
          <div className="absolute inset-0">
            <PCBViewport
              pcb={pcb}
              isRunning={isRunning}
              selectedId={selectedLive?.id ?? null}
              changedIds={changedIds}
              snapshotVersion={current?.version ?? -1}
              focusId={faultId}
              ripples={ripples}
              complete={complete}
              onSelect={setSelected}
            />
          </div>

          {current ? (
            <div className="pointer-events-none absolute left-6 top-5">
              <WorldHud
                snapshot={current}
                progress={progress}
                totalSteps={SNAPSHOTS.length}
              />
            </div>
          ) : (
            <div className="pointer-events-none absolute left-6 top-5 max-w-[20rem]">
              <div className="text-[20px] font-medium leading-tight text-dim">
                Idle
              </div>
              <div className="mt-1.5 text-[12px] text-ghost">
                Describe a board to begin synthesis.
              </div>
            </div>
          )}

          {!isLive ? (
            <div className="pointer-events-none absolute right-6 top-5 text-right">
              <div className="text-[12px] text-warn">Viewing history</div>
              <div className="font-mono text-[11px] text-faint">
                {currentIndex + 1} / {revealed}
              </div>
            </div>
          ) : null}

          {selectedLive ? (
            <div className="absolute bottom-5 left-6">
              <ComponentInspector
                component={selectedLive}
                onClose={() => setSelected(null)}
              />
            </div>
          ) : null}

          <div className="pointer-events-none absolute bottom-5 right-6">
            <Telemetry metrics={metrics} />
          </div>
        </section>

        {/* Instrumentation column: a tonal shift and a hairline, no panel. */}
        <aside className="flex min-h-0 flex-col border-l border-hair bg-raised">
          <ExecutionTrace history={history} />
        </aside>
      </div>

      {/* Footer: specification, run shape, state history. One band. */}
      <footer className="shrink-0 border-t border-hair px-6 py-3">
        <div className="flex items-center gap-8">
          <div className="min-w-0 flex-1">
            <SpecificationBar
              value={prompt}
              onChange={setPrompt}
              onBuild={runDemo}
              onReset={reset}
              isRunning={isRunning}
              hasRun={revealed > 0}
            />
          </div>

          {revealed > 0 ? (
            <>
              <StageRibbon
                stage={current?.stage ?? null}
                failed={failing}
                checkFailed={checkFailed}
              />
              <HistoryGraph
                snapshots={revealedSnapshots}
                currentIndex={currentIndex}
                totalCount={revealed}
                isLive={isLive}
                onScrub={scrubTo}
                onReturnToLive={returnToLive}
              />
            </>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
