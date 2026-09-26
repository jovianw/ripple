"use client";

import type { QueueItemDoc } from "@/lib/live";

interface QueueItemFull extends QueueItemDoc {
  depends_on?: string[];
  waiting_on?: string[];
  max_attempts?: number;
  error?: string;
}

const STATUS_INK: Record<string, string> = {
  done: "text-good",
  failed: "text-bad",
  running: "text-accent",
  pending: "text-faint",
};

export function QueueView({ items }: { items: QueueItemDoc[] }) {
  if (items.length === 0) {
    return (
      <p className="text-[12px] text-ghost">
        No work queue entries. Long-horizon boards populate this.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {items.map((raw) => {
        const item = raw as QueueItemFull;
        const waiting = item.waiting_on ?? [];
        const depends = item.depends_on ?? [];
        const status = item.stale ? "stalled" : (item.status ?? "—");

        return (
          <li key={item._id} className="flex items-baseline gap-3 text-[12px]">
            <span className="w-6 shrink-0 font-mono text-ghost">
              {item.step ?? "—"}
            </span>
            <span
              className={`w-16 shrink-0 ${
                item.stale ? "text-warn" : (STATUS_INK[item.status ?? ""] ?? "text-faint")
              }`}
            >
              {status}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-dim">{item.title ?? item.key}</span>
              {depends.length > 0 ? (
                <span className="text-ghost">
                  {" "}
                  · depends on {depends.length}
                </span>
              ) : null}
              {waiting.length > 0 ? (
                <span className="text-warn"> · waiting on {waiting.join(", ")}</span>
              ) : null}
              {item.error ? <span className="text-bad"> · {item.error}</span> : null}
            </span>
            {item.attempts !== undefined ? (
              <span className="shrink-0 font-mono text-[11px] text-ghost">
                {item.attempts}
                {item.max_attempts ? ` / ${item.max_attempts}` : ""}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
