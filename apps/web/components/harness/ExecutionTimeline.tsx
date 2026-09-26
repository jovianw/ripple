"use client";

import type { HarnessObservation } from "@/lib/harness-observability";
import { ACTOR_LABEL, STATUS_DOT, STATUS_INK, clockTime, fmtCost, fmtTokens } from "./primitives";

/** Real records in time order. Nothing here is synthesised. */
export function ExecutionTimeline({
  observations,
  selectedId,
  onSelect,
}: {
  observations: HarnessObservation[];
  selectedId: string | null;
  onSelect: (o: HarnessObservation) => void;
}) {
  if (observations.length === 0) {
    return <p className="text-[12px] text-ghost">No records for this board.</p>;
  }

  return (
    <ol className="relative">
      <span
        className="absolute left-[3px] top-2 w-px bg-hair"
        style={{ height: "calc(100% - 1rem)" }}
        aria-hidden
      />
      {observations.map((o) => {
        const selected = o.id === selectedId;
        return (
          <li key={o.id} className="relative pl-5">
            <span
              className={`absolute left-0 top-[9px] h-[7px] w-[7px] rounded-full ${STATUS_DOT[o.status]}`}
              aria-hidden
            />
            <button
              type="button"
              onClick={() => onSelect(o)}
              className={`flex w-full items-baseline gap-3 py-1 text-left text-[12px] ${
                selected ? "bg-white/[0.04]" : ""
              }`}
            >
              <span className="w-16 shrink-0 font-mono text-[11px] text-ghost">
                {clockTime(o.timestamp)}
              </span>
              <span className={`w-16 shrink-0 ${STATUS_INK[o.status]}`}>
                {ACTOR_LABEL[o.actor]}
              </span>
              <span className="min-w-0 flex-1 truncate text-dim">{o.summary}</span>
              {o.modelTier ? (
                <span className="shrink-0 font-mono text-[11px] text-ghost">
                  {o.modelTier}
                </span>
              ) : null}
              {o.usage?.tokens !== undefined ? (
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-ghost">
                  {fmtTokens(o.usage.tokens)}
                </span>
              ) : null}
              {o.usage?.costUsd !== undefined ? (
                <span className="w-14 shrink-0 text-right font-mono text-[11px] text-ghost">
                  {fmtCost(o.usage.costUsd)}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
