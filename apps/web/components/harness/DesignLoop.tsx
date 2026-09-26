"use client";

import { DESIGN_LOOP, type LoopStage } from "@/lib/harness-observability";

/**
 * The design loop, with live state on it.
 *
 * One SVG rather than laid-out divs: the feedback arrow has to run from
 * Critique back under the row to Write, and that path is far easier to place
 * exactly once than to chase with absolute positioning.
 *
 * Only the step the worker actually reported is highlighted. Spec and Write
 * never light up because no run is written for them — see the footnote.
 */

const BOX_W = 168;
const BOX_H = 92;
const GAP = 32;
const X0 = 16;
const TOP = 18;

const boxX = (i: number) => X0 + i * (BOX_W + GAP);
const boxCx = (i: number) => boxX(i) + BOX_W / 2;

const WRITE_INDEX = DESIGN_LOOP.findIndex((s) => s.id === "write");
const CRITIQUE_INDEX = DESIGN_LOOP.findIndex((s) => s.id === "critique");

const FEEDBACK_Y = TOP + BOX_H + 40;

export function DesignLoop({
  active,
  previous,
  failed,
}: {
  /** Loop step the newest run maps to. */
  active: LoopStage | null;
  /** Step before it, so the arrow between them can march. */
  previous: LoopStage | null;
  /** Newest check failed — the loop is taking the retry edge. */
  failed: boolean;
}) {
  const activeIndex = active ? DESIGN_LOOP.findIndex((s) => s.id === active) : -1;
  const previousIndex = previous
    ? DESIGN_LOOP.findIndex((s) => s.id === previous)
    : -1;

  // The edge entering the active step marches, so the loop always shows where
  // it currently is. `previous` brightens the step just left, giving the eye a
  // direction of travel without claiming an edge that was never logged.
  const movingEdge = activeIndex > 0 ? activeIndex - 1 : -1;

  return (
    <div>
      <svg
        viewBox={`0 0 1200 ${FEEDBACK_Y + 52}`}
        className="w-full"
        role="img"
        aria-label="Design loop with the current stage highlighted"
      >
        <defs>
          <marker
            id="loop-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
          </marker>
        </defs>

        {DESIGN_LOOP.map((stage, i) => {
          const isActive = i === activeIndex;
          const isPrevious = i === previousIndex && !isActive;
          const isFailing = isActive && failed;
          const stroke = isFailing
            ? "var(--bad)"
            : isActive
              ? "var(--accent)"
              : isPrevious
                ? "var(--line-soft)"
                : "var(--hair)";
          const title = isFailing
            ? "var(--bad)"
            : isActive
              ? "var(--accent)"
              : isPrevious
                ? "var(--dim)"
                : stage.telemetry
                  ? "var(--faint)"
                  : "var(--ghost)";

          return (
            <g key={stage.id}>
              <rect
                x={boxX(i)}
                y={TOP}
                width={BOX_W}
                height={BOX_H}
                rx={3}
                fill={isActive ? "rgba(78,201,224,0.06)" : "transparent"}
                stroke={stroke}
                strokeWidth={isActive ? 1.5 : 1}
              />
              <text
                x={boxCx(i)}
                y={TOP + 38}
                textAnchor="middle"
                fill={title}
                style={{ fontSize: 21, fontWeight: 500 }}
              >
                {stage.label}
              </text>
              <text
                x={boxCx(i)}
                y={TOP + 62}
                textAnchor="middle"
                fill="var(--ghost)"
                style={{ fontSize: 14 }}
              >
                {stage.sub}
              </text>
            </g>
          );
        })}

        {/* Forward connectors. The one entering the active step marches. */}
        {DESIGN_LOOP.slice(0, -1).map((stage, i) => {
          const moving = i === movingEdge;
          const x1 = boxX(i) + BOX_W + 4;
          const x2 = boxX(i + 1) - 6;
          const y = TOP + BOX_H / 2;
          return (
            <line
              key={`edge-${stage.id}`}
              x1={x1}
              y1={y}
              x2={x2}
              y2={y}
              stroke={moving ? "var(--accent)" : "var(--ghost)"}
              strokeWidth={moving ? 1.6 : 1.2}
              strokeDasharray={moving ? "4 4" : undefined}
              className={moving ? "dash-march" : undefined}
              markerEnd="url(#loop-arrow)"
              color={moving ? "var(--accent)" : "var(--ghost)"}
            />
          );
        })}

        {/* Feedback edge: Critique back to Write. Marches while retrying. */}
        <path
          d={`M ${boxCx(CRITIQUE_INDEX)} ${TOP + BOX_H + 4}
              V ${FEEDBACK_Y}
              H ${boxCx(WRITE_INDEX)}
              V ${TOP + BOX_H + 8}`}
          fill="none"
          stroke={failed ? "var(--warn)" : "var(--hair)"}
          strokeWidth={failed ? 1.6 : 1.2}
          strokeDasharray="4 4"
          className={failed ? "dash-march" : undefined}
          markerEnd="url(#loop-arrow)"
          color={failed ? "var(--warn)" : "var(--hair)"}
        />

        <text
          x={boxCx(WRITE_INDEX) + (boxCx(CRITIQUE_INDEX) - boxCx(WRITE_INDEX)) / 2}
          y={FEEDBACK_Y + 26}
          textAnchor="middle"
          fill={failed ? "var(--warn)" : "var(--ghost)"}
          style={{ fontSize: 15 }}
        >
          fail: fix and retry · pass: optimize area, vias and cost, then save
        </text>
      </svg>

      <p className="mt-1 text-[11px] text-ghost">
        Spec and Write write no run, so they never light up. Highlighted stage
        comes from the newest record&apos;s <span className="font-mono">stage</span>.
      </p>
    </div>
  );
}
