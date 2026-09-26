// Spec requests (docs/frontend-backend.md §5).
//
//   GET  /api/spec   -> { specs, requests, worker }   (read-only user)
//   POST /api/spec   { spec_id } -> 202 { request_id } (inserted with the requester user)
//
// The web app never runs anything itself: `npm run worker` on the demo laptop claims
// queued requests through a change stream and writes runs, boards and status.

import { NextResponse } from "next/server";

import { db, readAtlas } from "@/lib/db";
import { MAX_PENDING, requestsCollection, requestsConfigured } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 60_000;

export async function GET() {
  const result = await readAtlas(async () => {
    const [specs, requests] = await Promise.all([
      db()
        .collection("specs")
        .find({}, { sort: { _id: 1 }, projection: { _id: 1, split: 1, text: 1 } })
        .toArray(),
      db()
        .collection("spec_requests")
        .find({}, { sort: { created_at: -1 }, limit: 10 })
        .toArray(),
    ]);
    // A running request whose heartbeat stopped means the worker died; it resumes on restart.
    const now = Date.now();
    const running = requests.find((r) => r.status === "running");
    const stale = running?.heartbeat ? now - Date.parse(running.heartbeat) > STALE_MS : false;
    const oldestQueued = requests.filter((r) => r.status === "queued").at(-1);
    const waiting = oldestQueued ? now - Date.parse(oldestQueued.created_at) : 0;
    return {
      specs,
      requests,
      canSubmit: requestsConfigured(),
      worker: stale ? "stalled" : running ? "busy" : waiting > 15_000 ? "not responding" : "idle",
    };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 503 });
  return NextResponse.json(result.data, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!requestsConfigured()) {
    return NextResponse.json({ error: "Spec submission isn't configured on this deployment" }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { spec_id?: unknown } | null;
  const specId = typeof body?.spec_id === "string" ? body.spec_id.trim() : "";
  if (!specId) return NextResponse.json({ error: "spec_id is required" }, { status: 400 });

  try {
    const known = await db().collection("specs").countDocuments({ _id: specId as never }, { limit: 1 });
    if (!known) return NextResponse.json({ error: `Unknown spec ${specId}` }, { status: 400 });

    const requests = requestsCollection();
    const pending = await requests.countDocuments({ status: { $in: ["queued", "running"] } });
    if (pending >= MAX_PENDING) {
      return NextResponse.json({ error: `${pending} requests are already waiting; try again when one finishes` }, { status: 429 });
    }

    const { insertedId } = await requests.insertOne({
      spec_id: specId,
      status: "queued",
      created_at: new Date().toISOString(),
      source: "web",
    });
    return NextResponse.json({ request_id: insertedId.toString() }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "insert failed" }, { status: 503 });
  }
}
