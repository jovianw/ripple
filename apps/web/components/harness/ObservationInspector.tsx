"use client";

import {
  resolveMemory,
  type HarnessObservation,
} from "@/lib/harness-observability";
import type { LessonDoc, SubcircuitDoc } from "@/lib/live";
import { ACTOR_LABEL, Field, NotRecorded, clockTime, fmtCost, fmtTokens } from "./primitives";

export function ObservationInspector({
  observation,
  lessons,
  subcircuits,
}: {
  observation: HarnessObservation | null;
  lessons: LessonDoc[];
  subcircuits: SubcircuitDoc[];
}) {
  if (!observation) {
    return (
      <p className="text-[12px] text-ghost">
        Select a record in the timeline.
      </p>
    );
  }

  const o = observation;
  const mem = resolveMemory(o.memory, lessons, subcircuits);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Field label="Actor" mono={false}>
          {ACTOR_LABEL[o.actor]}
        </Field>
        {o.actorConfidence === "derived" && o.stage ? (
          <p className="-mt-2 text-[11px] text-ghost">
            Derived from stage: <span className="font-mono">{o.stage}</span>
          </p>
        ) : null}

        {o.stage ? <Field label="Stage">{o.stage}</Field> : null}
        <Field label="Board">{o.boardId.slice(0, 8)}</Field>
        {o.harnessVersion !== undefined ? (
          <Field label="Harness">v{String(o.harnessVersion).padStart(2, "0")}</Field>
        ) : null}
        <Field label="Timestamp">{clockTime(o.timestamp)}</Field>
      </div>

      <div className="border-t border-hair pt-4">
        {o.modelTier ? (
          <>
            <Field label={o.usageBelongsToProducer ? "Producer model" : "Model"}>
              {o.modelTier}
            </Field>
            {o.usageBelongsToProducer ? (
              <p className="mt-1 text-[11px] text-ghost">
                The checker is deterministic. This usage belongs to the coder
                call that produced the checked board.
              </p>
            ) : null}
          </>
        ) : (
          <NotRecorded what="— no model call on this record" />
        )}

        <div className="mt-3 flex gap-6">
          <Field label="Tokens">{fmtTokens(o.usage?.tokens)}</Field>
          <Field label="Cost">{fmtCost(o.usage?.costUsd)}</Field>
        </div>
      </div>

      {o.checker ? (
        <div className="border-t border-hair pt-4">
          <div className="flex items-baseline gap-3">
            <span className="text-[11px] text-faint">Checker</span>
            <span className={o.checker.passed ? "text-good" : "text-bad"}>
              {o.checker.passed ? "Passed" : "Failed"}
            </span>
            <span className="font-mono text-[11px] text-ghost">
              drc {o.checker.drcErrors}
            </span>
          </div>
          {o.checker.failures.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {o.checker.failures.slice(0, 6).map((f, i) => (
                <li key={`${f.check}-${i}`} className="text-[12px] leading-snug">
                  <span className="font-mono text-bad">{f.check}</span>
                  <span className="text-faint"> — {f.detail}</span>
                </li>
              ))}
              {o.checker.failures.length > 6 ? (
                <li className="text-[11px] text-ghost">
                  +{o.checker.failures.length - 6} more
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="border-t border-hair pt-4">
        <div className="text-[11px] text-faint">Memory used</div>
        {!o.memory ? (
          <div className="mt-1">
            <NotRecorded what="for this run" />
          </div>
        ) : (
          <div className="mt-1.5 space-y-2">
            {mem.lessons.map((l) => (
              <div key={l._id} className="text-[12px]">
                <span className="font-mono text-[11px] text-ghost">
                  {l._id.replace(/^lesson_/, "L-").slice(0, 10)}{" "}
                </span>
                <span className="text-dim">{l.pattern}</span>
              </div>
            ))}
            {mem.subcircuits.map((s) => (
              <div key={s._id} className="text-[12px]">
                <span className="font-mono text-[11px] text-ghost">sub </span>
                <span className="text-dim">{s.name}</span>
              </div>
            ))}
            {mem.unresolved > 0 ? (
              <p className="text-[11px] text-ghost">
                {mem.unresolved} id{mem.unresolved === 1 ? "" : "s"} not in the
                current memory page
              </p>
            ) : null}
          </div>
        )}
      </div>

      {o.workItem ? (
        <div className="border-t border-hair pt-4">
          <Field label="Work item" mono={false}>
            {o.workItem.title}
          </Field>
        </div>
      ) : null}
    </div>
  );
}
