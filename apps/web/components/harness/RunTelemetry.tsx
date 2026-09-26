"use client";

import { fmtCost, fmtTokens } from "./primitives";

/** Totals for the selected board. Latency is absent because nothing stores it. */
export function RunTelemetry({
  tokens,
  costUsd,
  modelCalls,
  attempts,
}: {
  tokens: number;
  costUsd: number;
  modelCalls: number;
  attempts: number;
}) {
  const items: [string, string][] = [
    ["tokens", fmtTokens(tokens)],
    ["cost", fmtCost(costUsd)],
    ["model calls", String(modelCalls)],
    ["attempts", String(attempts)],
  ];

  return (
    <div>
      {/* Distinguishes this from CurrentExecution's tokens/cost line just above, which is the latest
          event's own usage, not the board's running total. */}
      <div className="text-[10px] uppercase tracking-wider text-ghost">Board total</div>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
        {items.map(([label, value]) => (
          <span key={label} className="whitespace-nowrap text-[12px]">
            <span className="text-faint">{label} </span>
            <span className="font-mono text-dim [font-variant-numeric:tabular-nums]">
              {value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
