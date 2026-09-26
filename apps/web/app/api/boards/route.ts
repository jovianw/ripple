// Board index. circuit_json is large (100+ elements), so the list omits it and
// callers fetch one board when they want to draw it.

import { NextResponse } from "next/server";

import { db, readAtlas } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await readAtlas(async () => {
    const boards = await db()
      .collection("boards")
      .find(
        {},
        {
          sort: { created_at: -1 },
          limit: 40,
          projection: { circuit_json: 0, code: 0, source: 0, group_code: 0 },
        },
      )
      .toArray();
    return { boards, count: boards.length };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(result.data, {
    headers: { "cache-control": "no-store" },
  });
}
