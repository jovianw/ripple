"use client";

import type { Actor, ObservationStatus } from "@/lib/harness-observability";

export const ACTOR_LABEL: Record<Actor, string> = {
  planner: "Planner",
  coder: "Coder",
  critic: "Critic",
  checker: "Checker",
  assembler: "Assembler",
  meta: "Meta",
  system: "System",
  unknown: "Unknown",
};

export const STATUS_INK: Record<ObservationStatus, string> = {
  success: "text-good",
  failure: "text-bad",
  running: "text-accent",
  pending: "text-faint",
  info: "text-dim",
};

export const STATUS_DOT: Record<ObservationStatus, string> = {
  success: "bg-good",
  failure: "bg-bad",
  running: "bg-accent",
  pending: "bg-ghost",
  info: "bg-faint",
};

/** Section heading: a line of type, not a card. */
export function Head({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="text-[13px] text-ink">{title}</h2>
      {note ? <span className="text-[11px] text-faint">{note}</span> : null}
    </div>
  );
}

/** Label above a value. Values are monospace; labels never are. */
export function Field({
  label,
  children,
  mono = true,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-faint">{label}</div>
      <div className={`mt-0.5 text-[13px] text-ink ${mono ? "font-mono" : ""}`}>
        {children}
      </div>
    </div>
  );
}

/** Marks a value the backend does not record. Quiet on purpose. */
export function NotRecorded({ what }: { what: string }) {
  return <span className="text-[12px] text-ghost">Not recorded {what}</span>;
}

export const fmtTokens = (n: number | undefined): string =>
  n === undefined ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export const fmtCost = (n: number | undefined): string =>
  n === undefined ? "—" : `$${n.toFixed(n < 0.01 ? 4 : 3)}`;

export const clockTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "--:--:--"
    : d.toLocaleTimeString("en-GB", { hour12: false });
};
