"use client";

// The real build behind the scripted one: pressing Build on "/" also sends the
// specification to the worker (POST /api/spec { text }). This line follows that
// request. It never affects the scripted view — if Atlas or the worker is down,
// it says so here and the demo carries on (docs/frontend-backend.md §5).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface RequestState {
  status: "queued" | "running" | "done" | "failed";
  board_id?: string;
  passed?: boolean;
  attempts?: number;
  error?: string;
}

const POLL_MS = 2000;

export function RealBuildStatus({
  requestId,
  note,
  onBoard,
  onStatus,
  onFailed,
}: {
  requestId: string | null;
  note: string | null;
  /** Fired once, when the worker's board for this request exists. */
  onBoard?: (boardId: string) => void;
  /** Fired on each poll so the main view can show what the worker is doing. */
  onStatus?: (status: "queued" | "running") => void;
  /** Fired once, when the request ends without a board to show. */
  onFailed?: (error: string) => void;
}) {
  const [req, setReq] = useState<RequestState | null>(null);

  // The callbacks come from the parent as inline arrows, so their identity
  // changes on every render. Holding them in refs keeps them out of the
  // effect's dependencies — otherwise each status update tears the poller
  // down and restarts it, and the in-flight request carrying `done` is
  // discarded by the stale closure's `stopped` flag. That is exactly how a
  // finished build ended up never reaching the scene.
  const onBoardRef = useRef(onBoard);
  const onStatusRef = useRef(onStatus);
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onBoardRef.current = onBoard;
    onStatusRef.current = onStatus;
    onFailedRef.current = onFailed;
  }, [onBoard, onStatus, onFailed]);

  useEffect(() => {
    if (!requestId) return;
    let stopped = false;
    const poll = async () => {
      const r = await fetch(`/api/spec/${requestId}`, { cache: "no-store" }).catch(() => null);
      const json = (await r?.json().catch(() => null)) as RequestState | null;
      if (stopped || !json || !("status" in json)) return;
      setReq(json);
      if (json.status === "queued" || json.status === "running")
        onStatusRef.current?.(json.status);
      if (json.status === "done" || json.status === "failed") {
        stopped = true;
        if (json.status === "done" && json.board_id)
          onBoardRef.current?.(json.board_id);
        else
          onFailedRef.current?.(
            json.status === "failed"
              ? (json.error ?? "the worker could not build this board")
              : "the worker finished without producing a board",
          );
      }
    };
    const first = setTimeout(poll, 0);
    const timer = setInterval(() => !stopped && poll(), POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [requestId]);

  if (!requestId) return note ? <p className="mt-1 text-[11px] text-faint">{note}</p> : null;

  const status = req?.status ?? "queued";
  const label =
    status === "queued"
      ? "queued for the worker"
      : status === "running"
        ? "building on the worker"
        : status === "failed"
          ? `failed: ${req?.error ?? "unknown error"}`
          : req?.passed
            ? `built: passed generic checks in ${req.attempts ?? "?"} attempt(s)`
            : `built: did not pass generic checks after ${req?.attempts ?? "?"} attempt(s)`;

  return (
    <p className="mt-1 flex items-baseline gap-2 text-[11px]">
      <span className="text-faint">Real build</span>
      <span className={status === "failed" ? "text-bad" : status === "done" ? (req?.passed ? "text-good" : "text-warn") : "text-accent"}>
        {label}
      </span>
      {req?.board_id ? (
        <>
          <Link href={`/boards/${req.board_id}`} className="font-mono text-ghost hover:text-accent">
            open board
          </Link>
          <Link href={`/harness?board=${encodeURIComponent(req.board_id)}`} className="text-ghost hover:text-accent">
            harness logs
          </Link>
        </>
      ) : null}
      <Link href="/system" className="text-ghost hover:text-accent">
        system
      </Link>
    </p>
  );
}
