"use client";

import type { DesignMetrics } from "@/lib/types";

function Stat({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-[11px] text-faint">{label} </span>
      <span
        className={`font-mono text-[12px] [font-variant-numeric:tabular-nums] ${
          alert ? "text-bad" : "text-dim"
        }`}
      >
        {value}
      </span>
    </span>
  );
}

/** One quiet line of numbers. Derived from the board, never authored twice. */
export function Telemetry({ metrics }: { metrics: DesignMetrics }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
      <Stat label="parts" value={String(metrics.components)} />
      <Stat label="nets" value={String(metrics.nets)} />
      <Stat
        label="drc"
        value={String(metrics.drcErrors)}
        alert={metrics.drcErrors > 0}
      />
      <Stat
        label="board"
        value={`${metrics.boardWidthMm}×${metrics.boardHeightMm}mm`}
      />
      <Stat label="bom" value={`$${metrics.bomUsd.toFixed(2)}`} />
    </div>
  );
}
