"use client";

/**
 * Full input before a run; a one-line specification summary afterwards, so the
 * board owns the screen during the demo without the spec disappearing.
 */
export function PromptBar({
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
      <div className="flex items-center gap-3 px-4 py-2">
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-faint">
          Specification
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-dim" title={value}>
          {value}
        </span>
        <button
          type="button"
          onClick={onReset}
          disabled={isRunning}
          className="shrink-0 rounded-sm border border-line-strong px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-dim hover:border-accent hover:text-accent disabled:opacity-40"
        >
          New build
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex items-center gap-2 px-4 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isRunning) onBuild();
      }}
    >
      <label htmlFor="prompt" className="sr-only">
        What should Ripple build?
      </label>
      <input
        id="prompt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What should Ripple build?"
        className="min-w-0 flex-1 rounded-sm border border-line bg-raised px-3 py-1.5 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        disabled={value.trim().length === 0}
        className="shrink-0 rounded-sm bg-accent px-5 py-1.5 text-[13px] font-semibold text-[#06121f] hover:opacity-90 disabled:opacity-40"
      >
        Build
      </button>
    </form>
  );
}
