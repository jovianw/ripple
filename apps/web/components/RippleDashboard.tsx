"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavTabs } from "@/components/NavTabs";

import { ExecutionTrace } from "@/components/activity/ExecutionTrace";
import { DeliverablesPanel } from "@/components/deliverables/DeliverablesPanel";
import { HistoryGraph } from "@/components/build/HistoryGraph";
import { RealBuildStatus } from "@/components/build/RealBuildStatus";
import { SpecificationBar } from "@/components/build/SpecificationBar";
import { StageRibbon } from "@/components/build/StageRibbon";
import { Telemetry } from "@/components/build/Telemetry";
import { ComponentInspector } from "@/components/pcb/ComponentInspector";
import { PCBViewport } from "@/components/pcb/PCBViewport";
import { WorldHud } from "@/components/pcb/WorldHud";
import { buildSnapshotsFromBoard, type RealBoardPayload } from "@/lib/realRun";
import { deriveMetrics } from "@/lib/metrics";
import { diffPCBStates } from "@/lib/pcbDiff";
import { getJson } from "@/lib/usePolling";
import { EMPTY_PCB, type BuildSnapshot, type PCBComponent } from "@/lib/types";
import type { RunDoc } from "@/lib/live";

// A run is just a BuildSnapshot[]. It can come from the scripted walkthrough
// or from a board Ripple actually built — the scene cannot tell the difference,
// which is the point of the seam.
/** Every board on this page is one Ripple actually built. */
interface RunSource {
  label: string;
}

const DEFAULT_PROMPT = "Build a USB-C powered blinky";

// The worker keeps building whether or not this page is open, so the only
// thing lost by navigating away is the browser's memory of which request was
// yours. Parking it here means coming back reconnects to it.
const ACTIVE_KEY = "ripple.activeBuild";
const MAX_AGE_MS = 30 * 60 * 1000;

interface ActiveBuild {
  id: string;
  prompt: string;
  at: number;
}

function rememberBuild(active: ActiveBuild): void {
  try {
    window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
  } catch {
    // Private browsing or a full quota: reconnecting is a convenience, not a
    // requirement, so losing it is fine.
  }
}

function forgetBuild(): void {
  try {
    window.localStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

function recallBuild(): ActiveBuild | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveBuild;
    if (!parsed?.id || Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

// The example bundle (public/deliverables/t04) the panel shows until a real
// build has loaded; after that it shows the worker's views for that board.
const DELIVERABLES_BOARD_ID = "t04";

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
  const [showDeliverables, setShowDeliverables] = useState(false);
  /** The board the worker just built, once it's loaded; the deliverables panel shows its views. */
  const [realBoardId, setRealBoardId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<BuildSnapshot[]>([]);
  // Non-null while a real build is in flight: what the worker is doing now.
  const [awaiting, setAwaiting] = useState<
    "submitting" | "queued" | "running" | null
  >(null);
  const [source, setSource] = useState<RunSource | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Timers read liveness from a ref so scrubbing never has to cancel the run:
  // the build keeps completing in the background while the viewer looks back.
  const liveRef = useRef(true);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // A visible clock while the worker thinks. Vague prompts burn the repair
  // budget and can take half a minute, and silence reads as broken.
  useEffect(() => {
    if (startedAt === null) return;
    const tick = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(tick);
  }, [startedAt]);

  const play = useCallback(
    (sequence: BuildSnapshot[]) => {
      clearTimers();
      liveRef.current = true;
      setIsLive(true);
      setSelected(null);
      setIsRunning(true);
      setShowDeliverables(false);
      setSnapshots(sequence);
      setRevealed(1);
      setCurrentIndex(0);

      let at = 0;
      for (let i = 1; i < sequence.length; i++) {
        at += sequence[i - 1].delay ?? 800;
        const index = i;
        timers.current.push(
          setTimeout(() => {
            setRevealed(index + 1);
            if (liveRef.current) setCurrentIndex(index);
            if (index === sequence.length - 1) setIsRunning(false);
          }, at),
        );
      }
    },
    [clearTimers],
  );

  // Build also sends the specification to the real worker. Fire and forget: the
  // scripted run above never waits on Atlas, so a missing worker can't stall the demo.
  const [requestId, setRequestId] = useState<string | null>(null);
  const [requestNote, setRequestNote] = useState<string | null>(null);
  const build = useCallback(() => {
    // Don't animate a board nobody asked for. The worker takes a few seconds;
    // until it answers, the view waits on the real request and says so. The
    // scripted walkthrough is the fallback for when there is no worker at all.
    clearTimers();
    setRevealed(0);
    setCurrentIndex(-1);
    setSelected(null);
    setShowDeliverables(false);
    setAwaiting("submitting");
    setStartedAt(Date.now());
    setElapsed(0);
    setBuildError(null);
    setSource(null);
    setRequestId(null);
    setRequestNote(null);
    fetch("/api/spec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: prompt }),
    })
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (r.ok && json?.request_id) {
          setRequestId(json.request_id);
          setAwaiting("queued");
          rememberBuild({ id: json.request_id, prompt, at: Date.now() });
          return;
        }
        // Nothing is faked in its place: say why, and stop.
        setRequestNote(null);
        setAwaiting(null);
        setBuildError(json?.error ?? r.statusText ?? "the worker did not accept the request");
      })
      .catch(() => {
        setRequestNote(null);
        setAwaiting(null);
        setBuildError("the server is unreachable");
      });
  }, [prompt, clearTimers]);

  /**
   * The worker finished the specification that was submitted. Swap the
   * scripted walkthrough for the board it actually produced — same scene,
   * real parts, real traces, real verdict.
   */
  const showRealBoard = useCallback(
    async (boardId: string) => {
      const payload = await getJson<RealBoardPayload & { error?: string }>(
        `/api/boards/${encodeURIComponent(boardId)}`,
      );
      if (!payload || payload.error || !payload.pcb?.components?.length) {
        setAwaiting(null);
        setStartedAt(null);
        setBuildError(payload?.error ?? "the finished board could not be loaded");
        return;
      }

      const runs =
        (await getJson<{ runs?: RunDoc[] }>(
          `/api/runs?board_id=${encodeURIComponent(boardId)}&limit=50`,
        ))?.runs ?? [];

      setAwaiting(null);
      setStartedAt(null);
      setBuildError(null);
      setSource({ label: `real build · ${boardId.slice(0, 8)}` });
      setRealBoardId(boardId);
      play(
        buildSnapshotsFromBoard({
          spec: { _id: payload.board.spec_id ?? "free text", text: prompt },
          payload,
          runs,
        }),
      );
    },
    [play, prompt],
  );

  const reset = useCallback(() => {
    clearTimers();
    setRealBoardId(null);
    liveRef.current = true;
    setIsLive(true);
    setIsRunning(false);
    setRevealed(0);
    setCurrentIndex(-1);
    setSelected(null);
    setShowDeliverables(false);
    setSnapshots([]);
    setSource(null);
    setAwaiting(null);
    setBuildError(null);
    setStartedAt(null);
    forgetBuild();
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
    const params = new URLSearchParams(window.location.search);

    // ?board=<id> replays a board Ripple already built, in the main view.
    // Useful for the demo, and the only way to exercise the real-replay path
    // without waiting on the worker.
    const board = params.get("board");
    if (board) {
      const kickoff = setTimeout(() => void showRealBoard(board), 300);
      return () => clearTimeout(kickoff);
    }

    // ?request=<id> attaches to a build already in flight, so a refresh mid
    // build reconnects instead of losing it.
    const request = params.get("request");
    if (request) {
      const kickoff = setTimeout(() => {
        setAwaiting("queued");
        setRequestId(request);
      }, 0);
      return () => clearTimeout(kickoff);
    }

    // Nothing asked for in the URL: pick up the last build started from this
    // browser. If it finished while the page was closed, the poller sees
    // "done" on its first tick and renders the board straight away.
    const remembered = recallBuild();
    if (remembered) {
      const kickoff = setTimeout(() => {
        setPrompt(remembered.prompt);
        setAwaiting("queued");
        setStartedAt(remembered.at);
        setRequestId(remembered.id);
      }, 0);
      return () => clearTimeout(kickoff);
    }

    if (params.get("autoplay") !== "1") return;
    const kickoff = setTimeout(() => void build(), 400);
    return () => clearTimeout(kickoff);
  }, [build, showRealBoard]);

  const current = currentIndex >= 0 ? (snapshots[currentIndex] ?? null) : null;
  const pcb = current?.pcb ?? EMPTY_PCB;

  const diff = useMemo(() => {
    const previous =
      currentIndex > 0 ? (snapshots[currentIndex - 1]?.pcb ?? EMPTY_PCB) : EMPTY_PCB;
    return diffPCBStates(previous, pcb);
  }, [currentIndex, pcb, snapshots]);

  // Added parts animate by mounting; *changed* parts keep the same mesh, so the
  // diff is what tells the scene to re-highlight them.
  const changedIds = useMemo(
    () => new Set(diff.changedComponents.map((c) => c.id)),
    [diff],
  );

  const history = useMemo(
    () => snapshots.slice(0, isLive ? revealed : currentIndex + 1),
    [isLive, revealed, currentIndex, snapshots],
  );

  const revealedSnapshots = useMemo(
    () => snapshots.slice(0, revealed),
    [revealed, snapshots],
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
  const progress = revealed === 0 ? 0 : (currentIndex + 1) / snapshots.length;

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
        <div className="flex items-center gap-5">
          <span className="text-[15px] font-medium tracking-[0.08em] text-ink">
            Ripple
          </span>
          <NavTabs active="board" />
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
              complete={complete}
              onSelect={setSelected}
            />
          </div>

          {current ? (
            <div className="pointer-events-none absolute left-6 top-5">
              <WorldHud
                snapshot={current}
                progress={progress}
                totalSteps={snapshots.length}
              />
              {source ? (
                <div className="mt-2.5 text-[11px]">
                  <span className="text-good">● </span>
                  <span className="text-dim">{source.label}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="pointer-events-none absolute left-6 top-5 max-w-[22rem]">
              <div
                className={`text-[20px] font-medium leading-tight ${
                  awaiting ? "text-accent" : buildError ? "text-bad" : "text-dim"
                }`}
              >
                {awaiting === "submitting"
                  ? "Sending specification"
                  : awaiting === "queued"
                    ? "Queued for the worker"
                    : awaiting === "running"
                      ? "Designing on the worker"
                      : buildError
                        ? "Build not started"
                        : "Idle"}
              </div>
              <div className="mt-1.5 text-[12px] text-dim">
                {awaiting
                  ? "Ripple is designing this board now. It renders here when the worker answers."
                  : buildError
                    ? buildError
                    : "Describe a board to begin synthesis."}
              </div>
              {awaiting ? (
                <>
                  <div className="mt-2 font-mono text-[11px] text-faint [font-variant-numeric:tabular-nums]">
                    {elapsed}s elapsed · typical build 15–35s
                  </div>
                  <div className="mt-3 h-px w-40 bg-hair">
                    <div className="breathe h-px w-full bg-accent" />
                  </div>
                </>
              ) : null}
            </div>
          )}

          {!isLive ? (
            <div className="pointer-events-none absolute right-6 top-5 text-right">
              <div className="text-[12px] text-warn">Viewing history</div>
              <div className="font-mono text-[11px] text-dim">
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

          <div className="absolute bottom-5 right-6 flex items-baseline gap-5">
            <div className="pointer-events-none">
              <Telemetry metrics={metrics} />
            </div>
            {complete ? (
              <button
                type="button"
                onClick={() => setShowDeliverables(true)}
                className="trace-in text-[13px] text-accent hover:text-ink"
              >
                Deliverables →
              </button>
            ) : null}
          </div>

          {showDeliverables ? (
            <DeliverablesPanel
              boardId={realBoardId ?? DELIVERABLES_BOARD_ID}
              onClose={() => setShowDeliverables(false)}
            />
          ) : null}
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
              onBuild={build}
              onReset={reset}
              isRunning={isRunning}
              building={awaiting !== null || isRunning}
              hasRun={revealed > 0}
            />
            <RealBuildStatus
              requestId={requestId}
              note={requestNote}
              onBoard={(id) => void showRealBoard(id)}
              onStatus={(st) =>
                setAwaiting((prev) => (prev === null ? null : st))
              }
              onFailed={(error) => {
                setAwaiting(null);
                setStartedAt(null);
                setBuildError(error);
              }}
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
