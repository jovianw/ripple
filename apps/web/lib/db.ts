// Read-only Atlas access for the web app.
//
// Rules from docs/frontend-backend.md, which exist for good reasons:
//   - MONGODB_URI_READER only. The worker is the single writer; Atlas refuses
//     writes from this user anyway, but we also never try.
//   - Server-side only. Import this from route handlers or server components,
//     never from a client component.
//   - Do not import apps/worker/src/db.ts — it demands the writer URI and
//     throws without it. The queries here are deliberate copies.
//
// The client is cached on globalThis because dev hot-reload re-evaluates
// modules, and a fresh MongoClient per reload exhausts the connection pool.

import { MongoClient, type Db } from "mongodb";

const globalForMongo = globalThis as unknown as { _rippleMongo?: MongoClient };

function client(): MongoClient {
  const uri = process.env.MONGODB_URI_READER;
  if (!uri) {
    throw new Error(
      "MONGODB_URI_READER is not set. Add it to apps/web/.env.local locally, " +
        "and to the Vercel project's environment variables for deploys.",
    );
  }
  globalForMongo._rippleMongo ??= new MongoClient(uri, {
    appName: "ripple-web",
    // Fail fast: a hung request during a demo is worse than an honest error.
    serverSelectionTimeoutMS: 8000,
  });
  return globalForMongo._rippleMongo;
}

export const db = (): Db => client().db(process.env.MONGODB_DB || "ripple");

/** True when the app has been given a reader URI at all. */
export const atlasConfigured = (): boolean =>
  Boolean(process.env.MONGODB_URI_READER);

/** Embeddings are 1024 floats per document and never belong in a response. */
export const NO_EMBEDDING = { embedding: 0 } as const;

/**
 * Wraps a query so a database problem renders as a degraded panel rather than
 * a 500 that takes the page down mid-demo.
 */
export async function readAtlas<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!atlasConfigured()) {
    return { ok: false, error: "Atlas is not configured for this deployment" };
  }
  try {
    return { ok: true, data: await run() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "query failed" };
  }
}
