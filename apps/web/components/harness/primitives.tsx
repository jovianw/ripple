"use client";

import { useState } from "react";
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

/**
 * A toggle for detail that's real but not worth showing by default — full rule text, a long memory
 * list. `label` stays visible always (put the count/summary there); `children` only renders when open.
 */
export function Disclosure({
  label,
  defaultOpen = false,
  children,
}: {
  label: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] text-faint hover:text-dim"
      >
        <span className={`inline-block text-[9px] transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          ▶
        </span>
        {label}
      </button>
      {open ? <div className="mt-1.5">{children}</div> : null}
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
