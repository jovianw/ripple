// What the harness has learned: lessons from the critic, and verified
// subcircuits it can reuse. Embeddings and subcircuit code are projected out —
// 1024 floats and a full source file per document have no business in a list.

import { NextResponse } from "next/server";

import { db, readAtlas } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await readAtlas(async () => {
    const database = db();
    const [lessons, subcircuits] = await Promise.all([
      database
        .collection("lessons")
        .find(
          { active: true },
          { sort: { times_helped: -1 }, limit: 50, projection: { embedding: 0 } },
        )
        .toArray(),
      database
        .collection("subcircuits")
        .find(
          {},
          {
            sort: { reuse_count: -1 },
            limit: 50,
            projection: { embedding: 0, code: 0 },
          },
        )
        .toArray(),
    ]);

    return { lessons, subcircuits };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(result.data, {
    headers: { "cache-control": "no-store" },
  });
}
