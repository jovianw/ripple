"use client";

import { useState } from "react";
import { versionDiff } from "@/lib/harness-observability";
import type { HarnessDoc } from "@/lib/live";
import { Disclosure } from "./primitives";

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

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * One bar per version, oldest to newest, height = checks passed. Color is the verdict, the same
 * VERDICT_INK tokens used everywhere else (currentColor, so there's one source of truth for the
 * mapping). The point is the headline "is this getting smarter" question — the detailed diff/
 * rationale list below it answers "why", but this is what a judge should see in the first second.
 */
function EvolutionChart({ versions }: { versions: HarnessDoc[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ordered = [...versions].sort((a, b) => a.version - b.version);
  const barH = 108;

  const kept = ordered.filter(
    (v): v is HarnessDoc & { scores: { checks_passed: number } } =>
      v.verdict === "kept" && v.scores?.checks_passed !== undefined,
  );
  const first = kept.length > 0 ? kept[0] : null;
  const latest = kept.length > 0 ? kept[kept.length - 1] : null;
  const headline = first && latest && latest.version !== first.version ? latest.scores.checks_passed - first.scores.checks_passed : null;

  return (
    <div>
      {headline !== null && first && latest ? (
        <p className="text-[12px] text-faint">
          Checks passed, v{first.version} → v{latest.version}:{" "}
          <span className="font-mono text-dim">{pct(first.scores.checks_passed)}</span>
          <span className="text-ghost"> → </span>
          <span className="font-mono text-ink">{pct(latest.scores.checks_passed)}</span>
          {headline !== 0 ? (
            <span className={headline > 0 ? "text-good" : "text-bad"}>
              {" "}
              ({headline > 0 ? "+" : ""}
              {Math.round(headline * 100)}pp)
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="mt-3 flex items-end gap-1.5" style={{ height: barH }}>
        {ordered.map((v) => {
          const score = v.scores?.checks_passed;
          const h = score !== undefined ? Math.max(4, Math.round(score * barH)) : 3;
          const ink = VERDICT_INK[v.verdict ?? ""] ?? "text-dim";
          return (
            <div
              key={v.version}
              className="group relative flex flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(v.version)}
              onMouseLeave={() => setHover((cur) => (cur === v.version ? null : cur))}
            >
              {hover === v.version ? (
                <div className="absolute bottom-full z-10 mb-2 w-max max-w-[220px] rounded-sm border border-line bg-raised px-2.5 py-1.5 text-[11px] shadow-lg">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-ink">v{v.version}</span>
                    <span className={ink}>{v.verdict ?? "—"}</span>
                  </div>
                  {score !== undefined ? (
                    <div className="mt-0.5 text-faint">
                      checks <span className="font-mono text-dim">{pct(score)}</span>
                      {v.scores?.attempts_per_board !== undefined ? (
                        <>
                          {" · "}attempts <span className="font-mono text-dim">{v.scores.attempts_per_board.toFixed(1)}</span>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {v.rationale ? <div className="mt-1 max-w-[220px] text-faint">{v.rationale}</div> : null}
                </div>
              ) : null}
              <div
                className={`w-full rounded-t-sm ${ink} ${v.verdict === "kept" ? "opacity-100" : "opacity-60"}`}
                style={{ height: h, backgroundColor: "currentColor" }}
              />
              <span className="mt-1 font-mono text-[10px] text-ghost">v{v.version}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
        {(["kept", "rolled_back", "rejected", "pending"] as const).map((verdict) => (
          <span key={verdict} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${VERDICT_INK[verdict]}`} style={{ backgroundColor: "currentColor" }} />
            {verdict.replace("_", " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Board quality vs the parent, spec by spec, as the gate measured it (versions gated before this existed show nothing). */
function QualityChip({ quality, parent }: { quality: HarnessDoc["quality_vs_parent"]; parent: number | null }) {
  if (!quality || parent === null) return null;
  if (quality.ratio === null) {
    return <span className="text-[12px] text-faint">board quality: no shared passing spec</span>;
  }
  const change = (quality.ratio - 1) * 100;
  const ink = Math.abs(change) <= 3 ? "text-dim" : change > 0 ? "text-good" : "text-bad";
  return (
    <span className="text-[12px]">
      <span className="text-faint">board quality </span>
      <span className={`font-mono ${ink}`}>
        {change >= 0 ? "+" : "−"}
        {Math.abs(change).toFixed(0)}%
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
    <div>
      <EvolutionChart versions={versions} />

      <ol className="mt-6 space-y-3">
        {[...versions].reverse().map((v, i) => {
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
                {v.scores?.checks_passed !== undefined ? (
                  <span className="text-[11px] text-faint">
                    checks <span className="font-mono text-dim">{pct(v.scores.checks_passed)}</span>
                  </span>
                ) : null}
              </div>

              <div className="mt-1.5">
                <Disclosure
                  label={`${changes.length} rule change${changes.length === 1 ? "" : "s"}, rationale, scores`}
                  defaultOpen={i === 0}
                >
                  {changes.length > 0 ? (
                    <ul className="space-y-0.5">
                      {changes.map((c, ci) => (
                        <li key={`${c.field}-${ci}`} className="font-mono text-[11px]">
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
                </Disclosure>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
