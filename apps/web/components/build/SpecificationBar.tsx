"use client";

/**
 * Before a run: the specification is the input. After one: it is a caption,
 * and the action becomes plain text rather than a button shape.
 */
export function SpecificationBar({
  value,
  onChange,
  onBuild,
  onReset,
  isRunning,
  hasRun,
}: {
  value: string;
  onChange: (next: string) => void;
  onBuild: () => void;
  onReset: () => void;
  isRunning: boolean;
  hasRun: boolean;
}) {
  if (hasRun) {
    return (
      <div className="flex items-baseline gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-faint">Specification</div>
          <div className="mt-0.5 truncate text-[13px] text-dim" title={value}>
            {value}
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={isRunning}
          className="shrink-0 text-[13px] text-accent hover:text-ink disabled:text-ghost"
        >
          New build →
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex items-center gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isRunning) onBuild();
      }}
    >
      <label htmlFor="spec" className="sr-only">
        What should Ripple build?
      </label>
      <input
        id="spec"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe a board…"
        className="min-w-0 flex-1 border-b border-hair bg-transparent pb-1.5 text-[14px] text-ink placeholder:text-ghost focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        disabled={value.trim().length === 0}
        className="shrink-0 text-[14px] text-accent hover:text-ink disabled:text-ghost"
      >
        Build →
      </button>
    </form>
  );
}
