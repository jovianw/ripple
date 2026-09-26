// Harness config versions: the evolution history behind the config diff view.
// Rejected and rolled-back versions are returned too — the harness refusing a
// bad change is part of the story, not noise to filter out.

import { NextResponse } from "next/server";

import { db, readAtlas } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await readAtlas(async () => {
    const versions = await db()
      .collection("harness_versions")
      .find({}, { sort: { version: 1 } })
      .toArray();

    // Current config is the newest kept version (docs/frontend-backend.md §3).
    const current = [...versions]
      .reverse()
      .find((v) => v.verdict === "kept") ?? versions.at(-1) ?? null;

    return { versions, current, count: versions.length };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(result.data, {
    headers: { "cache-control": "no-store" },
  });
}
