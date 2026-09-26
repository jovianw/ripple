"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentActivity } from "@/components/activity/AgentActivity";
import { BuildTimeline } from "@/components/build/BuildTimeline";
import { MetricsStrip } from "@/components/build/MetricsStrip";
import { PromptBar } from "@/components/build/PromptBar";
import { StageProgress } from "@/components/build/StageProgress";
import { ComponentInspector } from "@/components/pcb/ComponentInspector";
import { OperationOverlay } from "@/components/pcb/OperationOverlay";
import { PCBViewport } from "@/components/pcb/PCBViewport";
import { DEFAULT_PROMPT, DEMO_SNAPSHOTS } from "@/lib/demoSnapshots";
import { deriveMetrics } from "@/lib/metrics";
import { diffPCBStates } from "@/lib/pcbDiff";
import { EMPTY_PCB, type PCBComponent } from "@/lib/types";

// Where the backend will plug in: today the snapshots come from a scripted
// array, later from an API or change stream. Nothing below this component
// knows the difference — it all takes BuildSnapshot props.
const SNAPSHOTS = DEMO_SNAPSHOTS;

function StatusChip({
  running,
  failing,
  repairing,
  complete,
}: {
  running: boolean;
  failing: boolean;
  repairing: boolean;
  complete: boolean;
}) {
  const [dot, label, ink] = failing
    ? ["bg-bad", "Check failed", "text-bad"]
    : repairing
      ? ["bg-warn pulse-dot", "Repairing", "text-warn"]
      : complete
        ? ["bg-good", "Checks passed", "text-good"]
        : running
          ? ["bg-accent pulse-dot", "Building", "text-accent"]
          : ["bg-white/25", "Idle", "text-faint"];

  return (
    <span className="flex items-center gap-2">
      <span className={`h-[7px] w-[7px] rounded-full ${dot}`} aria-hidden />
      <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${ink}`}>
        {label}
      </span>
    </span>
  );
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

  // What changed since the previous snapshot. Added parts animate in by virtue
  // of mounting; *changed* parts keep the same mesh, so the diff is what tells
  // the scene to re-highlight them.
  const changedIds = useMemo(() => {
    const previous =
      currentIndex > 0 ? SNAPSHOTS[currentIndex - 1].pcb : EMPTY_PCB;
    return new Set(
      diffPCBStates(previous, pcb).changedComponents.map((c) => c.id),
    );
  }, [currentIndex, pcb]);

  const history = useMemo(
    () => SNAPSHOTS.slice(0, isLive ? revealed : currentIndex + 1),
    [isLive, revealed, currentIndex],
  );

  const revealedSnapshots = useMemo(
    () => SNAPSHOTS.slice(0, revealed),
    [revealed],
  );

  const metrics = useMemo(() => deriveMetrics(pcb, current), [pcb, current]);

  // The part under investigation drives both the camera nudge and the chip.
  const faultId =
    pcb.components.find(
      (c) => c.status === "error" || c.status === "repairing",
    )?.id ?? null;

  // Keep the inspector in sync when a snapshot changes a part's status.
  const selectedLive = selected
    ? (pcb.components.find((c) => c.id === selected.id) ?? null)
    : null;

  const complete = current?.stage === "complete";
  const failing = current?.status === "error";
  const repairing = current?.stage === "repair" && !complete;
  const checkFailed = history.some((s) => s.status === "error");
  const progress = revealed === 0 ? 0 : (currentIndex + 1) / SNAPSHOTS.length;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-panel px-4">
        <div className="flex items-baseline gap-3">
          <span className="text-[14px] font-semibold tracking-[0.22em]">
            RIPPLE
          </span>
          <span className="hidden font-mono text-[10px] text-faint sm:inline">
            agentic PCB design
          </span>
        </div>
        <div className="flex items-center gap-5">
          <span className="font-mono text-[10px] text-faint">Harness v1</span>
          <StatusChip
            running={isRunning}
            failing={failing}
            repairing={repairing}
            complete={complete}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-1">
        <section className="flex min-h-0 flex-col">
          <div className="shrink-0 border-b border-line bg-panel">
            <MetricsStrip metrics={metrics} />
          </div>

          <div className="tech-grid relative min-h-[260px] flex-1">
            <div className="absolute inset-0">
              <PCBViewport
                pcb={pcb}
                isRunning={isRunning}
                selectedId={selectedLive?.id ?? null}
                changedIds={changedIds}
                snapshotVersion={current?.version ?? -1}
                focusId={faultId}
                onSelect={setSelected}
              />
            </div>

            {current ? (
              <div className="pointer-events-none absolute left-3 top-3">
                <OperationOverlay snapshot={current} progress={progress} />
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="rounded-sm border border-line bg-panel/80 px-4 py-2 text-xs text-dim backdrop-blur-sm">
                  Describe a board and press Build
                </p>
              </div>
            )}

            {!isLive ? (
              <div className="pointer-events-none absolute right-3 top-3 rounded-sm border border-warn/40 bg-warn/10 px-2.5 py-1 backdrop-blur-sm">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-warn">
                  History · snapshot {currentIndex + 1}/{revealed}
                </span>
              </div>
            ) : null}

            {selectedLive ? (
              <div className="absolute bottom-3 left-3">
                <ComponentInspector
                  component={selectedLive}
                  onClose={() => setSelected(null)}
                />
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-line bg-panel">
            <PromptBar
              value={prompt}
              onChange={setPrompt}
              onBuild={runDemo}
              onReset={reset}
              isRunning={isRunning}
              hasRun={revealed > 0}
            />
          </div>
        </section>

        <AgentActivity history={history} />
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-line bg-panel">
        <StageProgress
          stage={current?.stage ?? null}
          failed={failing}
          checkFailed={checkFailed}
        />
      </div>

      <div className="shrink-0 border-t border-line bg-panel">
        <BuildTimeline
          snapshots={revealedSnapshots}
          currentIndex={currentIndex}
          totalCount={revealed}
          isLive={isLive}
          onScrub={scrubTo}
          onReturnToLive={returnToLive}
        />
      </div>
    </div>
  );
}
