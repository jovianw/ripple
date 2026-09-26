"use client";

import { EXAMPLE_SPECS } from "@/lib/fixtures";

export function SpecInput({
  value,
  onChange,
  onSubmit,
  running,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  running: boolean;
}) {
  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-4">
      <h2 className="text-sm font-semibold">Board spec</h2>
      <p className="mt-1 text-xs text-secondary">
        Plain English. The harness never sees the checks it will be graded on.
      </p>

      <label htmlFor="spec" className="sr-only">
        Board spec
      </label>
      <textarea
        id="spec"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        disabled={running}
        placeholder="Read a temperature sensor over I2C, powered from USB-C, with a status LED."
        className="mt-3 w-full resize-y rounded-md border border-hairline bg-page px-3 py-2 text-sm text-primary placeholder:text-muted focus:border-series-1 focus:outline-none disabled:opacity-60"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLE_SPECS.map((example) => (
          <button
            key={example}
            type="button"
            disabled={running}
            onClick={() => onChange(example)}
            className="max-w-full truncate rounded-full border border-hairline px-3 py-1 text-xs text-secondary hover:border-series-1 hover:text-primary disabled:opacity-60"
            title={example}
          >
            {example.split(":")[0].split(",")[0]}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={running || value.trim().length === 0}
        className="mt-4 w-full rounded-md bg-series-1 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {running ? "Designing…" : "Design board"}
      </button>
    </section>
  );
}
