// Long-horizon progress. The interesting signal here is liveness: an item that
// is "running" with a heartbeat older than 30s means the worker died and the
// queue will resume it — which is the kill-and-resume demo beat, so the API
// computes staleness rather than making every caller re-derive it.

import { NextResponse } from "next/server";

import { db, readAtlas } from "@/lib/db";

/** Only the fields this route reasons about; the rest passes through. */
interface WorkItemDoc {
  board_id?: string;
  key?: string;
  title?: string;
  step?: number;
  status?: string;
  heartbeat?: string;
  [key: string]: unknown;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_AFTER_MS = 30_000;

export async function GET(request: Request) {
  const boardId = new URL(request.url).searchParams.get("board_id");

  const result = await readAtlas(async () => {
    const items = await db()
      .collection<WorkItemDoc>("work_queue")
      .find(boardId ? { board_id: boardId } : {}, { sort: { step: 1 } })
      .toArray();

    const now = Date.now();
    const annotated = items.map((item) => {
      const beat = typeof item.heartbeat === "string" ? Date.parse(item.heartbeat) : NaN;
      const stale =
        item.status === "running" &&
        Number.isFinite(beat) &&
        now - beat > STALE_AFTER_MS;
      return { ...item, stale };
    });

    const byStatus = annotated.reduce<Record<string, number>>((acc, i) => {
      const key = i.status ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return {
      items: annotated,
      byStatus,
      total: annotated.length,
      done: byStatus.done ?? 0,
      stalled: annotated.filter((i) => i.stale).length,
    };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(result.data, {
    headers: { "cache-control": "no-store" },
  });
}
