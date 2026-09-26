"use client";

import type { HarnessObservation } from "@/lib/harness-observability";
import type { QueueItemDoc } from "@/lib/live";
import { ACTOR_LABEL, fmtCost, fmtTokens } from "./primitives";

/** What the harness is doing right now, from the newest record that exists. */
export function CurrentExecution({
  latest,
  running,
}: {
  latest: HarnessObservation | null;
  running: QueueItemDoc | null;
}) {
  if (!latest) {
    return (
      <div>
        <div className="text-[20px] font-medium leading-tight text-dim">Idle</div>
        <div className="mt-1.5 text-[12px] text-ghost">
          No runs recorded yet.
        </div>
      </div>
    );
  }

  const ink =
    latest.status === "failure"
      ? "text-bad"
      : latest.status === "success"
        ? "text-ink"
        : "text-accent";

  return (
    <div>
      <div className="text-[11px] text-faint">
        {ACTOR_LABEL[latest.actor]}
        {latest.actorConfidence === "derived" && latest.stage ? (
          <span className="text-ghost"> · derived from stage</span>
        ) : null}
      </div>

      <div className={`mt-1 text-[20px] font-medium leading-tight ${ink}`}>
        {latest.summary}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] text-faint">
        {/* stage: dropped — the design-loop diagram right below highlights the same stage.
            harness version: dropped — it's persistent context, already shown in the Inspector panel
            and the Harness configuration section, not a fact specific to this event. */}
        {latest.modelTier ? (
          <span>
            {latest.usageBelongsToProducer ? "producer model" : "model"}{" "}
            <span className="font-mono text-dim">{latest.modelTier}</span>
          </span>
        ) : null}
        {latest.usage?.tokens !== undefined ? (
          <span>
            tokens{" "}
            <span className="font-mono text-dim">{fmtTokens(latest.usage.tokens)}</span>
          </span>
        ) : null}
        {latest.usage?.costUsd !== undefined ? (
          <span>
            cost <span className="font-mono text-dim">{fmtCost(latest.usage.costUsd)}</span>
          </span>
        ) : null}
      </div>

      {running ? (
        <div className="mt-3 text-[12px]">
          <span className="text-faint">Work item </span>
          <span className="text-dim">{running.title ?? running.key}</span>
          {running.attempts !== undefined ? (
            <span className="font-mono text-ghost">
              {" "}
              · attempt {running.attempts}
            </span>
          ) : null}
          {running.stale ? (
            <span className="text-warn"> · worker died, will resume</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
