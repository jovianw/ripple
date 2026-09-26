// Is the front end actually talking to Atlas? Cheap enough to poll, and it
// answers the one question you want answered before a demo.

import { NextResponse } from "next/server";

import { atlasConfigured, db, readAtlas } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();

  const result = await readAtlas(async () => {
    const database = db();
    const names = ["runs", "boards", "harness_versions", "lessons", "subcircuits", "work_queue"];
    const counts = Object.fromEntries(
      await Promise.all(
        names.map(async (n) => [n, await database.collection(n).estimatedDocumentCount()] as const),
      ),
    );
    return { database: database.databaseName, counts };
  });

  if (!result.ok) {
    return NextResponse.json(
      { connected: false, configured: atlasConfigured(), error: result.error },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { connected: true, configured: true, latency_ms: Date.now() - started, ...result.data },
    { headers: { "cache-control": "no-store" } },
  );
}
