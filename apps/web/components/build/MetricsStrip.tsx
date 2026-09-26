"use client";

import type { DesignMetrics } from "@/lib/types";

function Metric({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
        {label}
      </span>
      <span
        className={`font-mono text-[12px] [font-variant-numeric:tabular-nums] ${
          alert ? "text-bad" : "text-ink"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The engineering readout. Values derive from the board state, so the strip is
 * a view of the design rather than a second source of truth.
 */
export function MetricsStrip({ metrics }: { metrics: DesignMetrics }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-4 py-2">
      <Metric label="Components" value={String(metrics.components)} />
      <Metric label="Nets" value={String(metrics.nets)} />
      <Metric
        label="DRC"
        value={String(metrics.drcErrors)}
        alert={metrics.drcErrors > 0}
      />
      <Metric
        label="Board"
        value={`${metrics.boardWidthMm} × ${metrics.boardHeightMm} mm`}
      />
      <Metric label="BOM" value={`$${metrics.bomUsd.toFixed(2)}`} />
    </div>
  );
}
