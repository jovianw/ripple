// One board, already converted to the scene's view model.
//
// The adapter runs server-side on purpose: Circuit JSON for a small board is
// ~100 elements and most of them (schematic, silkscreen, solder paste) are
// never drawn, so converting here keeps them off the wire entirely.

import { NextResponse } from "next/server";

import { circuitJsonToPCBState } from "@/lib/circuitJson";
import { db, readAtlas } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const result = await readAtlas(async () => {
    const boards = db().collection("boards");
    // Accept a board_id or a spec_id, newest first — during a run the same
    // spec is rebuilt repeatedly and the latest attempt is the interesting one.
    const doc =
      (await boards.findOne({ board_id: id }, { sort: { created_at: -1 } })) ??
      (await boards.findOne({ spec_id: id }, { sort: { created_at: -1 } }));

    if (!doc) return null;

    const { pcb, errors, viaCount } = circuitJsonToPCBState(doc.circuit_json);
    return {
      board: {
        board_id: doc.board_id,
        spec_id: doc.spec_id,
        kind: doc.kind,
        harness_version: doc.harness_version,
        passed: doc.passed ?? null,
        failures: doc.failures ?? [],
        created_at: doc.created_at,
      },
      pcb,
      errors,
      viaCount,
      hasCircuitJson: Array.isArray(doc.circuit_json),
    };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  if (result.data === null) {
    return NextResponse.json({ error: `no board ${id}` }, { status: 404 });
  }
  return NextResponse.json(result.data, {
    headers: { "cache-control": "no-store" },
  });
}
