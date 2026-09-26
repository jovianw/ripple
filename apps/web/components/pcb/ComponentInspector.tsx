"use client";

import type { PCBComponent } from "@/lib/types";

const STATUS_TEXT: Record<string, { label: string; ink: string }> = {
  error: { label: "Error", ink: "text-bad" },
  repairing: { label: "Repairing", ink: "text-warn" },
  new: { label: "Placing", ink: "text-accent" },
  success: { label: "Healthy", ink: "text-good" },
  normal: { label: "Healthy", ink: "text-good" },
};

/** Floats in the world's lower corner; spacing separates it, not a border. */
export function ComponentInspector({
  component,
  onClose,
}: {
  component: PCBComponent;
  onClose: () => void;
}) {
  const status = STATUS_TEXT[component.status ?? "normal"];

  return (
    <div className="max-w-[17rem]">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[15px] text-ink">{component.label}</span>
        <span className="text-[13px] text-dim">
          {component.part ?? component.type}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[12px] text-dim hover:text-ink"
          aria-label="Close inspector"
        >
          ✕
        </button>
      </div>

      <div className="mt-1.5 flex items-baseline gap-2 text-[12px]">
        <span className={status.ink}>{status.label}</span>
        {component.placedDuring ? (
          <>
            <span className="text-faint">·</span>
            <span className="text-dim">placed in {component.placedDuring}</span>
          </>
        ) : null}
      </div>

      {component.note ? (
        <p className="mt-1.5 text-[12px] leading-snug text-bad">{component.note}</p>
      ) : null}
    </div>
  );
}
