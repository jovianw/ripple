"use client";

import { versionDiff } from "@/lib/harness-observability";
import type { HarnessDoc } from "@/lib/live";

const VERDICT_INK: Record<string, string> = {
  kept: "text-good",
  rejected: "text-bad",
  rolled_back: "text-warn",
  pending: "text-accent",
};

/** Score deltas are only shown when both sides actually exist. */
function ScoreDelta({
  label,
  from,
  to,
  format,
}: {
  label: string;
  from: number | undefined;
  to: number | undefined;
  format: (n: number) => string;
}) {
  if (to === undefined) return null;
  return (
    <span className="text-[12px]">
      <span className="text-faint">{label} </span>
      {from !== undefined ? (
        <>
          <span className="font-mono text-ghost">{format(from)}</span>
          <span className="text-ghost"> → </span>
        </>
      ) : null}
      <span className="font-mono text-dim">{format(to)}</span>
    </span>
  );
}

/** Board quality vs the parent, spec by spec, as the gate measured it (versions gated before this existed show nothing). */
function QualityChip({ quality, parent }: { quality: HarnessDoc["quality_vs_parent"]; parent: number | null }) {
  if (!quality || parent === null) return null;
  if (quality.ratio === null) {
    return <span className="text-[12px] text-faint">board quality: no shared passing spec</span>;
  }
  const pct = (quality.ratio - 1) * 100;
  const ink = Math.abs(pct) <= 3 ? "text-dim" : pct > 0 ? "text-good" : "text-bad";
  return (
    <span className="text-[12px]">
      <span className="text-faint">board quality </span>
      <span className={`font-mono ${ink}`}>
        {pct >= 0 ? "+" : "−"}
        {Math.abs(pct).toFixed(0)}%
      </span>
      <span className="text-faint">
        {" "}
        vs v{parent} ({quality.shared} spec{quality.shared === 1 ? "" : "s"})
      </span>
    </span>
  );
}

export function HarnessEvolution({ versions }: { versions: HarnessDoc[] }) {
  if (versions.length === 0) {
    return <p className="text-[12px] text-ghost">No harness versions stored.</p>;
  }

  const byVersion = new Map(versions.map((v) => [v.version, v]));

  return (
    <ol className="space-y-4">
      {[...versions].reverse().map((v) => {
        const parent = v.parent === null ? undefined : byVersion.get(v.parent);
        const changes = versionDiff(parent, v);

        return (
          <li key={v.version} className="border-l border-hair pl-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-mono text-[13px] text-ink">
                {parent ? `v${parent.version} → v${v.version}` : `v${v.version}`}
              </span>
              <span className={`text-[12px] ${VERDICT_INK[v.verdict ?? ""] ?? "text-dim"}`}>
                {v.verdict ?? "—"}
              </span>
            </div>

            {changes.length > 0 ? (
              <ul className="mt-1.5 space-y-0.5">
                {changes.map((c, i) => (
                  <li key={`${c.field}-${i}`} className="font-mono text-[11px]">
                    <span className="text-faint">{c.field} </span>
                    <span className="text-ghost">{c.from}</span>
                    <span className="text-ghost"> → </span>
                    <span className="text-dim">{c.to}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {v.rationale ? (
              <p className="mt-1.5 max-w-3xl text-[12px] leading-snug text-dim">
                {v.rationale}
              </p>
            ) : null}
            {v.gate_note ? (
              <p className="mt-1 max-w-3xl text-[12px] leading-snug text-faint">
                Gate: {v.gate_note}
              </p>
            ) : null}

            {v.scores ? (
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
                <ScoreDelta
                  label="checks passed"
                  from={parent?.scores?.checks_passed}
                  to={v.scores.checks_passed}
                  format={(n) => `${(n * 100).toFixed(0)}%`}
                />
                <ScoreDelta
                  label="partial credit"
                  from={parent?.scores?.check_score}
                  to={v.scores.check_score}
                  format={(n) => `${(n * 100).toFixed(0)}%`}
                />
                <QualityChip quality={v.quality_vs_parent} parent={v.parent} />
                <ScoreDelta
                  label="attempts"
                  from={parent?.scores?.attempts_per_board}
                  to={v.scores.attempts_per_board}
                  format={(n) => n.toFixed(1)}
                />
                <ScoreDelta
                  label="cost"
                  from={parent?.scores?.cost_per_board_usd}
                  to={v.scores.cost_per_board_usd}
                  format={(n) => `$${n.toFixed(4)}`}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
