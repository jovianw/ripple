// Deliverables API, shaped as specified in apps/worker/src/export/README.md.
//
//   GET /api/boards/:id/deliverables          -> manifest.json
//   GET /api/boards/:id/deliverables?file=... -> one file with its mime
//
// Today this serves a pre-generated bundle: buildDeliverables takes a couple of
// seconds, which is fine for a CLI and far too slow to sit in front of a live
// demo. When boards are in Atlas, swap resolveManifest for:
//
//   const board = await boards.findOne({ _id: id })
//   const d = await buildDeliverables({ circuitJson: board.circuit_json, name: id, ... })
//
// and keep the responses identical. Node runtime, never Edge: the exporter
// depends on @resvg/resvg-js, which is native.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface ManifestFile {
  path: string;
  category: string;
  description: string;
  mime: string;
  bytes: number;
}

interface Manifest {
  name: string;
  spec_id?: string;
  generated_at: string;
  metrics: Record<string, number>;
  files: ManifestFile[];
}

const bundleDir = (id: string) =>
  path.join(process.cwd(), "public", "deliverables", id);

/** Board ids come from the URL, so refuse anything that could escape the dir. */
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

async function readManifest(id: string): Promise<Manifest | null> {
  try {
    const raw = await readFile(path.join(bundleDir(id), "manifest.json"), "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return NextResponse.json({ error: "bad board id" }, { status: 400 });
  }

  const manifest = await readManifest(id);
  if (!manifest) {
    return NextResponse.json({ error: `no deliverables for ${id}` }, { status: 404 });
  }

  const wanted = new URL(request.url).searchParams.get("file");
  if (!wanted) return NextResponse.json(manifest);

  // Only ever serve a path the manifest itself lists — no traversal, no guessing.
  const entry = manifest.files.find((f) => f.path === wanted);
  if (!entry) {
    return NextResponse.json({ error: `not in manifest: ${wanted}` }, { status: 404 });
  }

  const data = await readFile(path.join(bundleDir(id), entry.path));
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": entry.mime,
      "content-length": String(entry.bytes),
      "cache-control": "public, max-age=3600",
    },
  });
}
