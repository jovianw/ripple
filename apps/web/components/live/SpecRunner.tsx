"use client";

// Submits a spec to the worker and tracks it (docs/frontend-backend.md §5).
// POST /api/spec inserts a request; `npm run worker` on the demo laptop runs it and
// writes status back; this panel polls GET /api/spec for the list and the worker state.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { ago } from "@/lib/live";

interface SpecDoc {
  _id: string;
  split: string;
  text: string;
}

interface RequestDoc {
  _id: string;
  spec_id: string;
  status: "queued" | "running" | "done" | "failed";
  created_at: string;
  board_id?: string;
  passed?: boolean;
  attempts?: number;
  error?: string;
}

type WorkerState = "idle" | "busy" | "stalled" | "not responding";

const POLL_MS = 2000;

const SPLIT_LABEL: Record<string, string> = {
  train: "Training",
  held_out: "Held out",
  finale: "Finale (long horizon)",
};

const STATUS_INK: Record<RequestDoc["status"], string> = {
  queued: "text-faint",
  running: "text-accent",
  done: "text-good",
  failed: "text-bad",
};

export function SpecRunner() {
  const [specs, setSpecs] = useState<SpecDoc[]>([]);
  const [requests, setRequests] = useState<RequestDoc[]>([]);
  const [worker, setWorker] = useState<WorkerState>("idle");
  const [canSubmit, setCanSubmit] = useState(false);
  const [specId, setSpecId] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/spec", { cache: "no-store" }).catch(() => null);
    const json = await r?.json().catch(() => null);
    if (!json || json.error) return;
    setSpecs(json.specs ?? []);
    setRequests(json.requests ?? []);
    setWorker(json.worker ?? "idle");
    setCanSubmit(Boolean(json.canSubmit));
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!specId || sending) return;
    setSending(true);
    setMessage(null);
    const r = await fetch("/api/spec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec_id: specId }),
    }).catch(() => null);
    const json = await r?.json().catch(() => null);
    setMessage(r?.ok ? "Queued. The worker picks it up in a moment." : (json?.error ?? "Couldn't submit"));
    setSending(false);
    load();
  };

  const selected = specs.find((s) => s._id === specId);
  const groups = ["train", "held_out", "finale"]
    .map((split) => ({ split, items: specs.filter((s) => s.split === split) }))
    .filter((g) => g.items.length);

  return (
    <section className="border-b border-hair py-5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[13px] text-ink">Run a spec</h2>
        <span
          className={`text-[11px] ${
            worker === "stalled" || worker === "not responding" ? "text-warn" : "text-faint"
          }`}
        >
          {worker === "busy"
            ? "worker busy"
            : worker === "stalled"
              ? "worker stopped mid-request · restart `npm run worker` to resume"
              : worker === "not responding"
                ? "no worker is picking requests up · run `npm run worker`"
                : "worker idle"}
        </span>
      </div>

      {canSubmit ? (
        <form onSubmit={submit} className="mt-2.5 flex flex-wrap items-center gap-3">
          <select
            value={specId}
            onChange={(e) => setSpecId(e.target.value)}
            className="min-w-64 rounded border border-hair bg-transparent px-2 py-1 text-[12px] text-ink"
          >
            <option value="">Choose a spec…</option>
            {groups.map((g) => (
              <optgroup key={g.split} label={SPLIT_LABEL[g.split] ?? g.split}>
                {g.items.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s._id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="submit"
            disabled={!specId || sending}
            className="rounded border border-hair px-3 py-1 text-[12px] text-ink hover:text-accent disabled:text-ghost"
          >
            {sending ? "Sending…" : "Run"}
          </button>
          {message ? <span className="text-[12px] text-dim">{message}</span> : null}
        </form>
      ) : (
        <p className="mt-2.5 text-[12px] text-ghost">
          Spec submission isn&apos;t configured here (MONGODB_URI_REQUESTS).
        </p>
      )}

      {selected ? <p className="mt-2 max-w-3xl text-[12px] leading-snug text-faint">{selected.text}</p> : null}

      {requests.length > 0 ? (
        <ol className="mt-3 space-y-1">
          {requests.map((r) => (
            <li key={r._id} className="flex items-baseline gap-3 text-[12px]">
              <span className={`w-16 shrink-0 ${STATUS_INK[r.status]}`}>
                {r.status === "done" ? (r.passed ? "passed" : "not passed") : r.status}
              </span>
              <span className="min-w-0 flex-1 truncate text-dim">
                {r.spec_id}
                {r.attempts !== undefined ? <span className="text-ghost"> · {r.attempts} attempt(s)</span> : null}
                {r.error ? <span className="text-bad"> · {r.error}</span> : null}
              </span>
              {r.board_id ? (
                <Link href={`/boards/${r.board_id}`} className="shrink-0 font-mono text-[11px] text-ghost hover:text-accent">
                  {r.board_id.slice(0, 14)}
                </Link>
              ) : null}
              <span className="shrink-0 font-mono text-[11px] text-ghost">{ago(r.created_at)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
