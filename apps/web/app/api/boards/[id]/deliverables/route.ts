// Deliverables API, shaped as specified in apps/worker/src/export/README.md.
//
//   GET /api/boards/:id/deliverables          -> manifest.json
//   GET /api/boards/:id/deliverables?file=... -> one file with its mime
//
// Two sources, same responses:
//   - a pre-generated bundle in public/deliverables/<id>/ (the t04 example, with
//     Gerbers, KiCad, 3D and zips);
//   - for boards the worker built, the views it stored on the board's latest
//     Atlas record (`deliverables`: PCB and schematic SVG, BOM, netlist). Those
//     manifests carry `live: true` and have no zips.
// Node runtime, never Edge.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { db, readAtlas } from "@/lib/db";

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
  /** Built by the worker and read from Atlas: views only, no download bundle. */
  live?: boolean;
}

interface StoredViews {
  manifest: Manifest;
  files: { path: string; content: string }[];
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

/** The views the worker stored on this board's latest record that has them. */
async function readStoredViews(id: string): Promise<StoredViews | null> {
  const res = await readAtlas(() =>
    db()
      .collection<{ board_id: string; deliverables?: StoredViews }>("boards")
      .find({ board_id: id, deliverables: { $exists: true } }, { projection: { deliverables: 1 } })
      .sort({ created_at: -1 })
      .limit(1)
      .next(),
  );
  return res.ok ? (res.data?.deliverables ?? null) : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return NextResponse.json({ error: "bad board id" }, { status: 400 });
  }

  const wanted = new URL(request.url).searchParams.get("file");
  const manifest = await readManifest(id);
  if (!manifest) {
    const stored = await readStoredViews(id);
    if (!stored) {
      return NextResponse.json({ error: `no deliverables for ${id}` }, { status: 404 });
    }
    if (!wanted) return NextResponse.json({ ...stored.manifest, live: true });
    const file = stored.files.find((f) => f.path === wanted);
    const entry = stored.manifest.files.find((f) => f.path === wanted);
    if (!file || !entry) {
      return NextResponse.json({ error: `not in manifest: ${wanted}` }, { status: 404 });
    }
    return new NextResponse(file.content, {
      headers: { "content-type": entry.mime, "cache-control": "no-store" },
    });
  }

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
