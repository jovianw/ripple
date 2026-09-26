"use client";

import type { FeedEvent, FeedEventKind } from "@/lib/fixtures";

// Status is never carried by color alone: every row ships a glyph and a written
// label beside the hue (palette.md, status palette).
const KIND_STYLE: Record<
  FeedEventKind,
  { glyph: string; label: string; ink: string }
> = {
  stage: { glyph: "•", label: "Step", ink: "text-muted" },
  fail: { glyph: "✕", label: "Failed", ink: "text-critical" },
  lesson: { glyph: "◆", label: "Lesson", ink: "text-warning" },
  fix: { glyph: "↻", label: "Fix", ink: "text-series-1" },
  pass: { glyph: "✓", label: "Passed", ink: "text-good" },
};

function Row({ event }: { event: FeedEvent }) {
  const style = KIND_STYLE[event.kind];

  return (
    <li className="feed-in flex gap-3 border-b border-gridline px-4 py-3 last:border-b-0">
      <span className={`mt-0.5 w-4 shrink-0 text-center ${style.ink}`} aria-hidden>
        {style.glyph}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-xs font-semibold ${style.ink}`}>{style.label}</span>
          {event.agent ? (
            <span className="rounded bg-page px-1.5 py-0.5 font-mono text-[10px] text-muted">
              {event.agent}
            </span>
          ) : null}
          <span className="text-sm text-primary">{event.title}</span>
        </div>

        {event.detail ? (
          <p className="mt-1 text-xs text-secondary">{event.detail}</p>
        ) : null}

        {event.run?.failures.map((failure) => (
          <p key={failure.check} className="mt-1 font-mono text-xs text-critical">
            {failure.check}: {failure.detail}
          </p>
        ))}

        {event.run?.metrics ? (
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted [font-variant-numeric:tabular-nums]">
            {[
              ["area", `${event.run.metrics.area_mm2} mm²`],
              ["vias", String(event.run.metrics.vias)],
              ["trace", `${event.run.metrics.trace_mm} mm`],
              ["bom", `$${event.run.metrics.bom_usd.toFixed(2)}`],
              ["cost", `$${(event.run.cost_usd ?? 0).toFixed(3)}`],
            ].map(([key, val]) => (
              <div key={key} className="flex gap-1">
                <dt>{key}</dt>
                <dd className="text-secondary">{val}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </li>
  );
}

export function RunFeed({
  events,
  running,
}: {
  events: FeedEvent[];
  running: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-hairline bg-surface-1">
      <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold">Run feed</h2>
        <span className="text-xs text-muted">
          {running ? "streaming…" : `${events.length} events`}
        </span>
      </header>

      {events.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">
          Enter a spec to start a run.
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto">
          {events.map((event) => (
            <Row key={event.id} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}
