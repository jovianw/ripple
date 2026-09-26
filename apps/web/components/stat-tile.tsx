// Stat tile: label (sentence case) + value + optional note. Values are large and
// standalone, so they keep the font's proportional figures; tabular-nums is for
// columns that have to align vertically.

export type TileStatus = "good" | "critical" | "neutral";

const STATUS_INK: Record<TileStatus, string> = {
  good: "text-good",
  critical: "text-critical",
  neutral: "text-primary",
};

export function StatTile({
  label,
  value,
  note,
  status = "neutral",
}: {
  label: string;
  value: string;
  note?: string;
  status?: TileStatus;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-1 px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${STATUS_INK[status]}`}>
        {value}
      </div>
      {note ? <div className="mt-0.5 text-xs text-secondary">{note}</div> : null}
    </div>
  );
}
