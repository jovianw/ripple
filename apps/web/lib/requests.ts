// The web app's only write path: inserting spec requests.
//
// Uses MONGODB_URI_REQUESTS, the `spec_requester` user, whose role is readWrite on
// ripple.spec_requests and nothing else (Atlas refuses it everything else, including
// reading runs). The worker (`npm run worker`) picks requests up through a change
// stream and does all the design-state writing. Server-side only.
// Contract: docs/frontend-backend.md §5.

import { MongoClient, type Collection } from "mongodb";

export interface SpecRequestDoc {
  /** A spec from the specs collection, or… */
  spec_id?: string;
  /** …free text (graded by generic checks built from the board, never by hidden checks). */
  text?: string;
  status: "queued" | "running" | "done" | "failed";
  created_at: string;
  source: "web";
  /** The signed-in user who submitted this (Auth.js user id). Requests only; the worker never reads this field. */
  user_id: string;
}

const globalForRequests = globalThis as unknown as { _rippleRequests?: MongoClient };

export const requestsConfigured = (): boolean => Boolean(process.env.MONGODB_URI_REQUESTS);

export function requestsCollection(): Collection<SpecRequestDoc> {
  const uri = process.env.MONGODB_URI_REQUESTS;
  if (!uri) {
    throw new Error(
      "MONGODB_URI_REQUESTS is not set. Add it to apps/web/.env.local locally, " +
        "and to the Vercel project's environment variables for deploys.",
    );
  }
  globalForRequests._rippleRequests ??= new MongoClient(uri, {
    appName: "ripple-web-requests",
    serverSelectionTimeoutMS: 8000,
  });
  return globalForRequests._rippleRequests
    .db(process.env.MONGODB_DB || "ripple")
    .collection<SpecRequestDoc>("spec_requests");
}

/** More pending requests than this and new ones are refused: the worker runs one at a time on a model budget. */
export const MAX_PENDING = 3;
