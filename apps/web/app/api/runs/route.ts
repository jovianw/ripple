// Live run feed. Poll with ?since=<iso> to get only what is new — that is the
// Vercel-compatible path (serverless functions can't hold a change stream
// open; docs/frontend-backend.md §3).

import { NextResponse } from "next/server";

import { db, NO_EMBEDDING, readAtlas } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const boardId = url.searchParams.get("board_id");
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50),
  );

  const result = await readAtlas(async () => {
    const filter: Record<string, unknown> = {};
    if (boardId) filter.board_id = boardId;
    // ts is stored as an ISO string, so a lexicographic compare is a time
    // compare — no date parsing needed on either side.
    if (since) filter.ts = { $gt: since };

    const runs = await db()
      .collection("runs")
      .find(filter, {
        sort: { ts: boardId ? 1 : -1 },
        limit,
        projection: NO_EMBEDDING,
      })
      .toArray();

    return { runs, count: runs.length, latest: runs[0]?.ts ?? since ?? null };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(result.data, {
    headers: { "cache-control": "no-store" },
  });
}
