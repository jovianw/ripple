"use client";

/**
 * Before a run: the specification is the input. After one: it is a caption,
 * and the action becomes plain text rather than a button shape. The input
 * state is deliberately prominent: it is the one thing to do on an empty page.
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
      className="flex items-center gap-3"
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
        className="min-w-0 flex-1 rounded-md border border-line-soft bg-raised px-4 py-2.5 text-[14px] text-ink shadow-[0_0_0_1px_rgba(78,201,224,0.08)] placeholder:text-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(78,201,224,0.18)] focus:outline-none"
      />
      <button
        type="submit"
        disabled={value.trim().length === 0}
        className="shrink-0 rounded-md bg-accent px-5 py-2.5 text-[14px] font-semibold text-[#06121f] hover:opacity-90 disabled:opacity-40"
      >
        Build →
      </button>
    </form>
  );
}
