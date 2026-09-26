"use client";

// The real build behind the scripted one: pressing Build on "/" also sends the
// specification to the worker (POST /api/spec { text }). This line follows that
// request. It never affects the scripted view — if Atlas or the worker is down,
// it says so here and the demo carries on (docs/frontend-backend.md §5).

import { useEffect, useState } from "react";
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
}: {
  requestId: string | null;
  note: string | null;
  /** Fired once, when the worker's board for this request exists. */
  onBoard?: (boardId: string) => void;
}) {
  const [req, setReq] = useState<RequestState | null>(null);

  useEffect(() => {
    if (!requestId) return;
    let stopped = false;
    const poll = async () => {
      const r = await fetch(`/api/spec/${requestId}`, { cache: "no-store" }).catch(() => null);
      const json = (await r?.json().catch(() => null)) as RequestState | null;
      if (stopped || !json || !("status" in json)) return;
      setReq(json);
      if (json.status === "done" || json.status === "failed") {
        stopped = true;
        if (json.status === "done" && json.board_id) onBoard?.(json.board_id);
      }
    };
    const first = setTimeout(poll, 0);
    const timer = setInterval(() => !stopped && poll(), POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [requestId, onBoard]);

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
        <Link href={`/boards/${req.board_id}`} className="font-mono text-ghost hover:text-accent">
          open board
        </Link>
      ) : null}
      <Link href="/system" className="text-ghost hover:text-accent">
        system
      </Link>
    </p>
  );
}
