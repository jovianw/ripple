// Creates collections, regular indexes and vector indexes. Safe to re-run.
// M0 allows only 3 search indexes per cluster, so vector indexes go on subcircuits, lessons and runs.
import { client, col, connect, COLLECTIONS, db } from "../apps/worker/src/db.ts";

const dims = Number(process.env.VOYAGE_DIMS || 1024); // voyage-4 default

await connect();

const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
for (const name of COLLECTIONS) {
  if (!existing.has(name)) await db.createCollection(name);
}
console.log(`collections: ${COLLECTIONS.join(", ")}`);

await col.harness.createIndex({ version: -1 }, { unique: true });
await col.specs.createIndex({ spec_id: 1 }, { unique: true });
await col.boards.createIndex({ board_id: 1, version: -1 });
await col.queue.createIndex({ status: 1, board_id: 1 });
await col.runs.createIndex({ board_id: 1, ts: -1 });
await col.runs.createIndex({ harness_version: 1, passed: 1 }); // feeds the ablation table
await col.requests.createIndex({ status: 1, created_at: 1 }); // the worker claims the oldest queued request
await col.requests.createIndex({ user_id: 1, created_at: -1 }); // a signed-in user's own request history
console.log("regular indexes: ok");

const vectorIndexes = [
  { collection: col.subcircuits, name: "subcircuits_vec", filters: [] as string[] },
  { collection: col.lessons, name: "lessons_vec", filters: ["active"] },
  { collection: col.runs, name: "runs_vec", filters: ["passed", "harness_version"] },
];

for (const { collection, name, filters } of vectorIndexes) {
  const [found] = (await collection.listSearchIndexes(name).toArray()) as { status?: string }[];
  if (found) {
    console.log(`${name}: exists (${found.status})`);
    continue;
  }
  await collection.createSearchIndex({
    name,
    type: "vectorSearch",
    definition: {
      fields: [
        { type: "vector", path: "embedding", numDimensions: dims, similarity: "cosine" },
        ...filters.map((path) => ({ type: "filter", path })),
      ],
    },
  });
  console.log(`${name}: created (builds in a minute or two)`);
}

await client.close();
