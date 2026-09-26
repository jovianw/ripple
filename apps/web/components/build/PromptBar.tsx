"use client";

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
  return (
    <form
      className="flex items-center gap-2 px-4 py-3"
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
        disabled={isRunning}
        placeholder="What should Ripple build?"
        className="min-w-0 flex-1 rounded-md border border-line bg-raised px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
      />

      <button
        type="submit"
        disabled={isRunning || value.trim().length === 0}
        className="shrink-0 rounded-md bg-accent px-5 py-2 text-[13px] font-semibold text-[#06121f] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {isRunning ? "Building…" : "Build"}
      </button>

      {hasRun && !isRunning ? (
        <button
          type="button"
          onClick={onReset}
          className="shrink-0 rounded-md border border-line-strong px-3 py-2 text-[13px] text-dim hover:border-line-strong hover:text-ink"
        >
          Reset
        </button>
      ) : null}
    </form>
  );
}
