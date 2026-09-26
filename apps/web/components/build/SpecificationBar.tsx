"use client";

/**
 * Before a run: the specification is the input. After one: it is a caption,
 * and the action becomes plain text rather than a button shape. The input
 * state is deliberately prominent: it is the one thing to do on an empty page.
 * While a build is in flight the action says so, and can't be pressed twice.
 */
export function SpecificationBar({
  value,
  onChange,
  onBuild,
  onReset,
  isRunning,
  building,
  hasRun,
}: {
  value: string;
  onChange: (next: string) => void;
  onBuild: () => void;
  onReset: () => void;
  isRunning: boolean;
  /** A build is submitted, queued, designing, or playing back. */
  building: boolean;
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
          disabled={isRunning || building}
          className={`shrink-0 text-[13px] ${
            building ? "breathe text-accent" : "text-accent hover:text-ink disabled:text-ghost"
          }`}
        >
          {building ? "Building…" : "New build →"}
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isRunning && !building) onBuild();
      }}
    >
      <label htmlFor="spec" className="sr-only">
        What should Ripple build?
      </label>
      <input
        id="spec"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={building}
        placeholder="Describe a board…"
        className="min-w-0 flex-1 rounded-md border border-line-soft bg-raised px-4 py-2.5 text-[14px] text-ink shadow-[0_0_0_1px_rgba(78,201,224,0.08)] placeholder:text-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(78,201,224,0.18)] focus:outline-none"
      />
      <button
        type="submit"
        disabled={building || value.trim().length === 0}
        aria-busy={building}
        className={`shrink-0 rounded-md bg-accent px-5 py-2.5 text-[14px] font-semibold text-[#06121f] ${
          building ? "breathe cursor-progress" : "hover:opacity-90 disabled:opacity-40"
        }`}
      >
        {building ? "Building…" : "Build →"}
      </button>
    </form>
  );
}
