"use client";

import type { BlockSplit, PCBBlock } from "@/lib/blocks";

/**
 * Shown when a build is still failing after every repair attempt. Instead of
 * leaving the failed board on screen, it proposes the next move: split the
 * design into blocks, keep the ones that work, and rebuild the failing ones one
 * at a time.
 */
export function BreakItUp({
  split,
  attempts,
  view,
  onView,
  onRebuildBlock,
  onRetryBoard,
  disabled,
}: {
  split: BlockSplit;
  attempts: number;
  view: "blocks" | "board";
  onView: (view: "blocks" | "board") => void;
  onRebuildBlock: (block: PCBBlock) => void;
  onRetryBoard: () => void;
  disabled: boolean;
}) {
  const { blocks, unattributed } = split;
  const failing = blocks.filter((b) => b.failing).length;
  const canSplit = blocks.length > 1;

  return (
    <div className="w-[20rem] rounded-md border border-line-soft bg-[#1b1f29]/90 p-4 backdrop-blur-sm">
      <div className="text-[11px] uppercase tracking-[0.14em] text-bad">
        Still failing after {attempts} attempt{attempts === 1 ? "" : "s"}
      </div>
      <div className="mt-1.5 text-[15px] font-medium leading-snug text-ink">
        {canSplit ? "Break it up and iterate block by block" : "Iterate on the board"}
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-dim">
        {canSplit
          ? `Split into ${blocks.length} blocks at their wiring seams. ${
              failing
                ? failing === blocks.length
                  ? "Every block has a failure: rebuild them one at a time, starting from the top, then reassemble."
                  : `Keep the ${blocks.length - failing} that pass and rebuild ${failing === 1 ? "the failing one on its own" : `the ${failing} failing ones one at a time`}, then reassemble.`
                : "No single block is to blame; the failures are in how they connect."
            }`
          : "This board is one block, so the next step is another pass with the failures in hand."}
      </p>

      {canSplit ? (
        <div className="mt-3 flex gap-1 rounded-md border border-line-soft p-0.5 text-[12px]">
          {(["blocks", "board"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onView(v)}
              className={`flex-1 rounded-[5px] px-2 py-1 ${
                view === v ? "bg-accent/15 font-medium text-accent" : "text-dim hover:text-ink"
              }`}
            >
              {v === "blocks" ? "Blocks" : "Whole board"}
            </button>
          ))}
        </div>
      ) : null}

      {canSplit ? (
        <ol className="mt-3 space-y-2">
          {blocks.map((block, i) => (
            <li
              key={block.id}
              className={`rounded-md border px-3 py-2 ${
                block.failing ? "border-bad/40 bg-bad/5" : "border-line-soft"
              }`}
            >
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className={block.failing ? "text-bad" : "text-good"}>
                  {block.failing ? "✕" : "✓"}
                </span>
                <span className="font-mono text-dim">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-ink" title={block.title}>
                  {block.title}
                </span>
                <span className="shrink-0 text-dim">
                  {block.componentIds.length} part{block.componentIds.length === 1 ? "" : "s"}
                </span>
              </div>
              {block.failures.length > 0 ? (
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-dim" title={block.failures.map((f) => f.detail).join("\n")}>
                  {block.failures[0].detail}
                  {block.failures.length > 1 ? ` (+${block.failures.length - 1} more)` : ""}
                </p>
              ) : null}
              {block.failing ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRebuildBlock(block)}
                  className="mt-2 rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-[#06121f] hover:opacity-90 disabled:opacity-40"
                >
                  Rebuild this block →
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {unattributed.length > 0 || !canSplit || failing === 0 ? (
        <div className="mt-3 border-t border-line-soft pt-3">
          {unattributed.length > 0 ? (
            <>
              <div className="text-[11px] text-dim">Not tied to one block</div>
              <ul className="mt-1 space-y-1">
                {unattributed.slice(0, 3).map((f, i) => (
                  <li key={i} className="line-clamp-2 text-[11px] leading-snug text-dim" title={f.detail}>
                    <span className="font-mono text-bad">{f.check}</span> {f.detail}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            onClick={onRetryBoard}
            className="mt-2 text-[12px] text-accent hover:text-ink disabled:text-ghost"
          >
            Retry the whole board with these failures →
          </button>
        </div>
      ) : null}
    </div>
  );
}
