// Copies the public spec text (specs/specs.json + specs/finale.json) into the `specs` collection, so the web app can
// offer them with its read-only user. Only { _id, spec_id, split, text }: no hidden-check content. Safe to re-run.
//   npm run seed:specs
import specs from "../specs/specs.json" with { type: "json" };
import finale from "../specs/finale.json" with { type: "json" };
import { client, col, connect } from "../apps/worker/src/db.ts";

const all = [
  ...(specs as { _id: string; split: string; text: string }[]).map(({ _id, split, text }) => ({ _id, spec_id: _id, split, text })),
  { _id: finale._id, spec_id: finale._id, split: "finale", text: finale.text },
];

await connect();
const res = await col.specs.bulkWrite(
  all.map((s) => ({ replaceOne: { filter: { _id: s._id }, replacement: s, upsert: true } })) as never,
);
console.log(`specs: ${all.length} (${res.upsertedCount} new, ${res.modifiedCount} updated)`);
await client.close();
