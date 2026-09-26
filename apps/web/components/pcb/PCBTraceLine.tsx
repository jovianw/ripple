"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import type { PCBTrace } from "@/lib/types";
import { BOARD_TOP, COLORS, TRACE_LIFT } from "./pcbScene.shared";

/** How long a new trace takes to draw itself in. */
const DRAW_MS = 600;

type Pt = [number, number, number];

const lift = (x: number, y: number): Pt => [x, BOARD_TOP + TRACE_LIFT, -y];

/** Total polyline length, used to spread the reveal evenly along the path. */
function segmentLengths(points: { x: number; y: number }[]): {
  lengths: number[];
  total: number;
} {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const len = Math.hypot(dx, dy);
    lengths.push(len);
    total += len;
  }
  return { lengths, total };
}

/**
 * Progressive reveal: walk the polyline and cut it at `progress` of its total
 * length. Simple, allocation-light, and it reads as "the router is drawing".
 */
function partialPath(
  points: { x: number; y: number }[],
  lengths: number[],
  total: number,
  progress: number,
): Pt[] {
  if (progress >= 1 || total === 0) return points.map((p) => lift(p.x, p.y));

  const target = total * progress;
  const out: Pt[] = [lift(points[0].x, points[0].y)];
  let walked = 0;

  for (let i = 0; i < lengths.length; i++) {
    if (walked + lengths[i] >= target) {
      const t = lengths[i] === 0 ? 0 : (target - walked) / lengths[i];
      const a = points[i];
      const b = points[i + 1];
      out.push(lift(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
      return out;
    }
    walked += lengths[i];
    out.push(lift(points[i + 1].x, points[i + 1].y));
  }
  return out;
}

const COLOR_BY_STATUS: Record<NonNullable<PCBTrace["status"]>, string> = {
  normal: COLORS.copper,
  new: COLORS.copperBright,
  error: COLORS.error,
  repairing: COLORS.repairing,
};

export function PCBTraceLine({ trace }: { trace: PCBTrace }) {
  const elapsed = useRef(0);
  const [progress, setProgress] = useState(0);

  // Frame-loop reveal is the nice path, but useFrame stops accumulating if the
  // tab is throttled or the renderer stalls, which would strand a trace at zero
  // length. This guarantees it is fully drawn shortly after mount either way.
  useEffect(() => {
    const settle = setTimeout(() => setProgress(1), DRAW_MS + 80);
    return () => clearTimeout(settle);
  }, []);

  const { lengths, total } = useMemo(
    () => segmentLengths(trace.points),
    [trace.points],
  );

  useFrame((_, delta) => {
    if (progress >= 1) return;
    elapsed.current += delta * 1000;
    setProgress(Math.min(1, elapsed.current / DRAW_MS));
  });

  const points = useMemo(
    () => partialPath(trace.points, lengths, total, progress),
    [trace.points, lengths, total, progress],
  );

  const status = trace.status ?? "normal";

  // A two-point line is the minimum drei's Line will accept.
  if (points.length < 2) return null;

  return (
    <Line
      points={points}
      color={COLOR_BY_STATUS[status]}
      lineWidth={trace.width ?? 2.4}
    />
  );
}
