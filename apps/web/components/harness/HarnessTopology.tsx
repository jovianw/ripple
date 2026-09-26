"use client";

import {
  TOPOLOGY,
  UNINSTRUMENTED,
  type Actor,
} from "@/lib/harness-observability";

/**
 * The harness's known architecture, with live state laid over it.
 *
 * This is not a reconstructed call graph — the worker does not log edges. The
 * boxes are the components that exist; the highlight says which of them
 * produced telemetry recently. Nodes that cannot report at all are labelled as
 * such rather than drawn idle, because idle would imply we would know.
 */
export function HarnessTopology({
  active,
  lastActor,
}: {
  active: Set<Actor>;
  lastActor: Actor | null;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-3">
        {TOPOLOGY.map((node, i) => {
          const uninstrumented = UNINSTRUMENTED.has(node.actor);
          const isActive = !uninstrumented && active.has(node.actor);
          const isLast = !uninstrumented && lastActor === node.actor;

          return (
            <div key={node.actor} className="flex items-center gap-1.5">
              <div
                className={`flex flex-col items-start rounded-sm px-2.5 py-1.5 transition-colors ${
                  isActive
                    ? "bg-accent/10"
                    : isLast
                      ? "bg-white/[0.03]"
                      : ""
                }`}
              >
                <span
                  className={`text-[12px] ${
                    uninstrumented
                      ? "text-ghost"
                      : isActive
                        ? "text-accent"
                        : isLast
                          ? "text-dim"
                          : "text-faint"
                  }`}
                >
                  {node.label}
                </span>
                <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ghost">
                  {uninstrumented ? "no telemetry" : isActive ? "active" : "idle"}
                </span>
              </div>
              {i < TOPOLOGY.length - 1 ? (
                <span className="text-ghost" aria-hidden>
                  ·
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-ghost">
        Known architecture with live state overlaid. Edges are not logged, so
        none are drawn. Planner activity is not persisted to <span className="font-mono">runs</span>.
      </p>
    </div>
  );
}
