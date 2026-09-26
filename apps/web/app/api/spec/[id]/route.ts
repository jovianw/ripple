// One spec request's status: GET /api/spec/:id (read-only user).
// status: queued → running → done | failed, plus board_id (join runs/boards on it), passed, attempts, error.

import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { db, readAtlas } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "bad request id" }, { status: 400 });

  const result = await readAtlas(() => db().collection("spec_requests").findOne({ _id: new ObjectId(id) }));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 503 });
  if (!result.data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(result.data, { headers: { "cache-control": "no-store" } });
}
