"use client";

import type { PCBComponent } from "@/lib/types";

const STATUS_TEXT: Record<string, { label: string; ink: string }> = {
  error: { label: "Error", ink: "text-bad" },
  repairing: { label: "Repairing", ink: "text-warn" },
  new: { label: "Placing", ink: "text-accent" },
  success: { label: "Healthy", ink: "text-good" },
  normal: { label: "Healthy", ink: "text-good" },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
        {label}
      </dt>
      <dd className="mt-0.5 text-[12px] text-ink">{children}</dd>
    </div>
  );
}

/** Compact overlay pinned to the canvas, not a permanent sidebar. */
export function ComponentInspector({
  component,
  onClose,
}: {
  component: PCBComponent;
  onClose: () => void;
}) {
  const status = STATUS_TEXT[component.status ?? "normal"];

  return (
    <div className="w-[14.5rem] rounded-sm border border-line bg-panel/90 px-3 py-2.5 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
          Inspector
        </span>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-0.5 px-1 text-faint hover:text-ink"
          aria-label="Close inspector"
        >
          ✕
        </button>
      </div>

      <dl className="mt-2 space-y-2">
        <Row label="Reference">
          <span className="font-mono">{component.label}</span>
        </Row>
        <Row label="Component">{component.part ?? component.type}</Row>
        <Row label="Status">
          <span className={status.ink}>{status.label}</span>
        </Row>
        {component.placedDuring ? (
          <Row label="Placed during">
            <span className="capitalize text-dim">{component.placedDuring}</span>
          </Row>
        ) : null}
        {component.note ? (
          <Row label="Current issue">
            <span className="text-bad">{component.note}</span>
          </Row>
        ) : null}
      </dl>
    </div>
  );
}
