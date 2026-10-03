// Spec requests (docs/frontend-backend.md §5).
//
//   GET  /api/spec   -> { specs, requests, worker, user }   (read-only user; requests scoped to the signed-in user)
//   POST /api/spec   { spec_id } | { text } -> 202 { request_id } (requires sign-in; inserted with the requester user)
//
// The web app never runs anything itself: `npm run worker` on the demo laptop claims
// queued requests through a change stream and writes runs, boards and status.

import { NextResponse } from "next/server";

import { auth, authConfigured } from "@/lib/auth";
import { db, readAtlas } from "@/lib/db";
import { MAX_PENDING, MAX_PENDING_GLOBAL, requestsCollection, requestsConfigured } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 60_000;

export async function GET() {
  const session = authConfigured() ? await auth() : null;
  const userId = session?.user?.id ?? null;

  const result = await readAtlas(async () => {
    const [specs, requests] = await Promise.all([
      db()
        .collection("specs")
        .find({}, { sort: { _id: 1 }, projection: { _id: 1, split: 1, text: 1 } })
        .toArray(),
      // Scoped to the signed-in user: this is their own build history, not the global feed
      // (the worker status below still needs every request, so it's read unfiltered).
      userId
        ? db().collection("spec_requests").find({ user_id: userId }, { sort: { created_at: -1 }, limit: 10 }).toArray()
        : [],
    ]);
    // Targeted queries, not derived from a small "last 10" window: with per-user caps, total
    // in-flight requests routinely exceeds 10, and a window would silently pick the wrong
    // "oldest queued"/miss a stale "running" one that aged out of it.
    const [oldestQueued, runningNow] = await Promise.all([
      db().collection("spec_requests").find({ status: "queued" }, { sort: { created_at: 1 }, limit: 1 }).toArray(),
      // Bounded by worker concurrency (a handful at once), never by request volume.
      db().collection("spec_requests").find({ status: "running" }, { limit: 50 }).toArray(),
    ]);
    // A running request whose heartbeat stopped means the worker died; it resumes on restart.
    const now = Date.now();
    const stale = runningNow.some((r) => r.heartbeat && now - Date.parse(r.heartbeat) > STALE_MS);
    const waiting = oldestQueued[0] ? now - Date.parse(oldestQueued[0].created_at) : 0;
    return {
      specs,
      requests,
      user: session?.user ? { name: session.user.name, email: session.user.email } : null,
      canSubmit: requestsConfigured() && (!authConfigured() || Boolean(userId)),
      worker: stale ? "stalled" : runningNow.length > 0 ? "busy" : waiting > 15_000 ? "not responding" : "idle",
    };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 503 });
  return NextResponse.json(result.data, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!requestsConfigured()) {
    return NextResponse.json({ error: "Spec submission isn't configured on this deployment" }, { status: 503 });
  }
  // No auth configured on this deployment at all (docs/demo.md's three-Mongo-vars setup):
  // submissions stay anonymous, same as before auth existed. Once auth IS configured, signing
  // in is required — don't 401 an unconfigured deployment just because session is always null.
  const session = authConfigured() ? await auth() : null;
  if (authConfigured() && !session?.user?.id) {
    return NextResponse.json({ error: "sign in to build a board" }, { status: 401 });
  }
  const userId = session?.user?.id;

  const body = (await request.json().catch(() => null)) as { spec_id?: unknown; text?: unknown } | null;
  const specId = typeof body?.spec_id === "string" ? body.spec_id.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!specId && !text) return NextResponse.json({ error: "send spec_id or text" }, { status: 400 });
  if (text && (text.length < 10 || text.length > 1000)) {
    return NextResponse.json({ error: "describe the board in 10 to 1000 characters" }, { status: 400 });
  }

  try {
    if (specId) {
      const known = await db().collection("specs").countDocuments({ _id: specId as never }, { limit: 1 });
      if (!known) return NextResponse.json({ error: `Unknown spec ${specId}` }, { status: 400 });
    }

    const requests = requestsCollection();
    // Global cap first: the real backstop for one worker on a shared model budget — per-user
    // caps alone let N signed-in users queue up to N × MAX_PENDING between them, unbounded.
    const pendingGlobal = await requests.countDocuments({ status: { $in: ["queued", "running"] } });
    if (pendingGlobal >= MAX_PENDING_GLOBAL) {
      return NextResponse.json({ error: `${pendingGlobal} requests are already waiting across all users; try again when one finishes` }, { status: 429 });
    }
    // Per-user cap, on top of the global one: keeps one active user from using the whole budget.
    if (userId) {
      const pending = await requests.countDocuments({ user_id: userId, status: { $in: ["queued", "running"] } });
      if (pending >= MAX_PENDING) {
        return NextResponse.json({ error: `${pending} of your requests are already waiting; try again when one finishes` }, { status: 429 });
      }
    }

    const { insertedId } = await requests.insertOne({
      ...(specId ? { spec_id: specId } : { text }),
      status: "queued",
      created_at: new Date().toISOString(),
      source: "web",
      ...(userId ? { user_id: userId } : {}),
    });
    return NextResponse.json({ request_id: insertedId.toString() }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "insert failed" }, { status: 503 });
  }
}
