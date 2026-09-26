// Long-term memory: Voyage embeddings + Atlas Vector Search + Voyage rerank. Owner: Jovian.
// Lessons and verified subcircuits are the semantic memory; failed runs are the episodic memory.
// How much comes back (k, rerank on/off) is set by the harness config, so the meta-agent can tune it.
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { HarnessConfig, Lesson } from "@ripple/types";
import type { Collection, Document } from "mongodb";
import { col, type StoredLesson, type StoredSubcircuit } from "../db.js";

type ContextPolicy = HarnessConfig["context"];

const VOYAGE = "https://api.voyageai.com/v1";
const CANDIDATES = 20; // vector hits handed to the reranker before trimming to k

async function voyage(path: string, body: unknown): Promise<any> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${VOYAGE}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    // Rate limited (parallel ablation runs, or an account without a payment method): back off and retry.
    if (res.status === 429 && attempt < 4) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 5_000 * 2 ** attempt));
      continue;
    }
    throw new Error(`voyage ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** Embeds short descriptions (not raw code). Use "query" for search text, "document" for stored text. */
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const json = await voyage("embeddings", {
    input: texts,
    model: process.env.VOYAGE_MODEL || "voyage-4",
    input_type: inputType,
  });
  return json.data.map((d: { embedding: number[] }) => d.embedding);
}

/** Indices of `documents`, best first, as judged by the reranker. */
export async function rerank(query: string, documents: string[], topK: number): Promise<number[]> {
  if (!documents.length) return [];
  const json = await voyage("rerank", {
    query,
    documents,
    model: process.env.VOYAGE_RERANK_MODEL || "rerank-2.5",
    top_k: topK,
  });
  return json.data.map((d: { index: number }) => d.index);
}

async function vectorSearch<T extends Document>(
  collection: Collection<T>,
  index: string,
  queryVector: number[],
  limit: number,
  filter?: Document,
): Promise<(T & { score: number })[]> {
  const pipeline: Document[] = [
    { $vectorSearch: { index, path: "embedding", queryVector, numCandidates: Math.max(100, limit * 10), limit, ...(filter && { filter }) } },
    { $set: { score: { $meta: "vectorSearchScore" } } },
    { $project: { embedding: 0 } },
  ];
  return collection.aggregate<T & { score: number }>(pipeline).toArray();
}

/** Vector search for CANDIDATES hits, then rerank (if the policy says so) and keep the top k. */
async function retrieve<T extends Document>(
  query: string,
  k: number,
  policy: ContextPolicy,
  search: (vector: number[], limit: number) => Promise<(T & { score: number })[]>,
  textOf: (hit: T) => string,
): Promise<(T & { score: number })[]> {
  if (k <= 0) return [];
  const [vector] = await embed([query], "query");
  const hits = await search(vector, policy.rerank ? Math.max(k, CANDIDATES) : k);
  if (!policy.rerank || hits.length <= 1) return hits.slice(0, k);
  const order = await rerank(query, hits.map(textOf), k);
  return order.map((i) => hits[i]);
}

const lessonText = (l: Pick<Lesson, "pattern" | "fix">) => `${l.pattern}. Fix: ${l.fix}`;
const hashId = (prefix: string, text: string) =>
  `${prefix}_${createHash("sha1").update(text.trim().toLowerCase()).digest("hex").slice(0, 12)}`;

// ---- lessons (learned design rules) ----

/** Stores a lesson. The same pattern always maps to the same id, so re-learning it updates instead of duplicating. */
export async function addLesson(lesson: { pattern: string; fix: string }): Promise<string> {
  const _id = hashId("lesson", lesson.pattern);
  const [embedding] = await embed([lessonText(lesson)], "document");
  await col.lessons.updateOne(
    { _id },
    {
      $set: { pattern: lesson.pattern, fix: lesson.fix, embedding, active: true },
      $setOnInsert: { times_helped: 0, created_at: new Date() },
    },
    { upsert: true },
  );
  return _id;
}

/** The lessons most relevant to a spec or failure summary, up to `context.lessons_k`. */
export async function retrieveLessons(query: string, policy: ContextPolicy) {
  return retrieve<StoredLesson>(
    query,
    policy.lessons_k,
    policy,
    (v, limit) => vectorSearch(col.lessons, "lessons_vec", v, limit, { active: true }),
    lessonText,
  );
}

/** Credit lessons that were in context when a board passed; the meta-agent can see which ones earn their place. */
export async function markLessonsHelped(ids: string[]) {
  if (ids.length) await col.lessons.updateMany({ _id: { $in: ids } }, { $inc: { times_helped: 1 } });
}

// ---- subcircuits (verified building blocks) ----

/** Saves a verified subcircuit. `description` is what gets embedded, so write it the way a spec would ask for it. */
export async function addSubcircuit(sub: {
  name: string;
  description: string;
  code: string;
  checks_passed: string[];
}): Promise<string> {
  const _id = hashId("sub", sub.name);
  const [embedding] = await embed([sub.description], "document");
  await col.subcircuits.updateOne(
    { _id },
    { $set: { ...sub, embedding }, $setOnInsert: { reuse_count: 0, created_at: new Date() } },
    { upsert: true },
  );
  return _id;
}

/** Library subcircuits worth reusing for this spec, up to `context.subcircuits_k`. */
export async function retrieveSubcircuits(query: string, policy: ContextPolicy) {
  return retrieve<StoredSubcircuit>(
    query,
    policy.subcircuits_k,
    policy,
    (v, limit) => vectorSearch(col.subcircuits, "subcircuits_vec", v, limit),
    (s) => s.description,
  );
}

export async function markSubcircuitsReused(ids: string[]) {
  if (ids.length) await col.subcircuits.updateMany({ _id: { $in: ids } }, { $inc: { reuse_count: 1 } });
}

// ---- failed runs (episodic memory) ----

/** Attaches a searchable summary to a failed run so later failures can find it. */
export async function indexFailure(runId: string, summary: string) {
  const [embedding] = await embed([summary], "document");
  await col.runs.updateOne({ _id: runId }, { $set: { failure_summary: summary, embedding } });
}

/** Past failed runs that look like this one, e.g. to show the critic how a similar failure was fixed. */
export async function similarFailures(summary: string, k: number, policy: ContextPolicy) {
  return retrieve(
    summary,
    k,
    policy,
    (v, limit) => vectorSearch(col.runs, "runs_vec", v, limit, { passed: false }),
    (r) => r.failure_summary ?? "",
  );
}
