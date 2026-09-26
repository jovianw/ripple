// What changed between two snapshots. The scene uses this to decide what
// animates: added parts drop in, changed parts re-flash, removed parts vanish.
// Everything is keyed on stable ids.

import type { PCBComponent, PCBState, PCBTrace } from "./types";

export interface PCBDiff {
  addedComponents: PCBComponent[];
  removedComponents: PCBComponent[];
  changedComponents: PCBComponent[];
  addedTraces: PCBTrace[];
  removedTraces: PCBTrace[];
  changedTraces: PCBTrace[];
}

const byId = <T extends { id: string }>(items: T[]): Map<string, T> =>
  new Map(items.map((item) => [item.id, item]));

function componentChanged(a: PCBComponent, b: PCBComponent): boolean {
  return (
    a.status !== b.status ||
    a.position.x !== b.position.x ||
    a.position.y !== b.position.y ||
    a.rotation !== b.rotation ||
    a.label !== b.label ||
    a.note !== b.note
  );
}

function traceChanged(a: PCBTrace, b: PCBTrace): boolean {
  if (a.status !== b.status) return true;
  if (a.points.length !== b.points.length) return true;
  return a.points.some(
    (point, i) => point.x !== b.points[i].x || point.y !== b.points[i].y,
  );
}

export function diffPCBStates(previous: PCBState, next: PCBState): PCBDiff {
  const prevComponents = byId(previous.components);
  const nextComponents = byId(next.components);
  const prevTraces = byId(previous.traces);
  const nextTraces = byId(next.traces);

  return {
    addedComponents: next.components.filter((c) => !prevComponents.has(c.id)),
    removedComponents: previous.components.filter(
      (c) => !nextComponents.has(c.id),
    ),
    changedComponents: next.components.filter((c) => {
      const before = prevComponents.get(c.id);
      return before !== undefined && componentChanged(before, c);
    }),
    addedTraces: next.traces.filter((t) => !prevTraces.has(t.id)),
    removedTraces: previous.traces.filter((t) => !nextTraces.has(t.id)),
    changedTraces: next.traces.filter((t) => {
      const before = prevTraces.get(t.id);
      return before !== undefined && traceChanged(before, t);
    }),
  };
}
