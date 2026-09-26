"use client";

import type { HarnessDoc } from "@/lib/live";
import { Field } from "./primitives";

const asNum = (v: unknown): string =>
  typeof v === "number" ? String(v) : v === undefined ? "—" : String(v);

const asBool = (v: unknown): string =>
  v === true ? "on" : v === false ? "off" : "—";

/** The config that produced the runs on screen. */
export function HarnessVersionView({ version }: { version: HarnessDoc | null }) {
  if (!version) {
    return <p className="text-[12px] text-ghost">No harness config loaded.</p>;
  }

  const ctx = (version.context ?? {}) as Record<string, unknown>;
  const wf = (version.workflow ?? {}) as Record<string, unknown>;
  const routing = (version.routing ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Field label="Version">v{String(version.version).padStart(2, "0")}</Field>
        <Field label="Rules">{String(version.rules?.length ?? 0)}</Field>
        <Field label="Lessons k">{asNum(ctx.lessons_k)}</Field>
        <Field label="Subcircuits k">{asNum(ctx.subcircuits_k)}</Field>
        <Field label="Rerank">{asBool(ctx.rerank)}</Field>
        <Field label="Repair budget">{asNum(wf.repair_budget)}</Field>
      </div>

      {Object.keys(routing).length > 0 ? (
        <div>
          <div className="text-[11px] text-faint">Routing</div>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
            {Object.entries(routing).map(([agent, tier]) => (
              <span key={agent} className="text-[12px]">
                <span className="text-faint">{agent} </span>
                <span className="font-mono text-dim">{String(tier)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {version.rules && version.rules.length > 0 ? (
        <div>
          <div className="text-[11px] text-faint">Rules</div>
          <ul className="mt-1 space-y-0.5">
            {version.rules.map((r) => (
              <li key={r} className="text-[12px] text-dim">
                {r}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
