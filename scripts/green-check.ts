// Green check (runbook step 6): every service answers before real work starts.
//   npm run green                  all checks
//   npm run green -- atlas voyage  only the named checks
// The tscircuit check belongs with Arjun's tool wrappers (apps/worker/src/tools/).
import { Client as LangSmith } from "langsmith";
import { traceable } from "langsmith/traceable";
import { MongoClient, MongoServerError } from "mongodb";

const only = new Set(process.argv.slice(2));
let failed = 0;

async function check(name: string, fn: () => Promise<string>) {
  if (only.size && !only.has(name)) return;
  try {
    console.log(`✓ ${name.padEnd(8)} ${await fn()}`);
  } catch (err) {
    failed++;
    console.log(`✗ ${name.padEnd(8)} ${err instanceof Error ? err.message : String(err)}`);
  }
}

function env(...names: string[]) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`missing in .env: ${missing.join(", ")}`);
  return names.map((n) => process.env[n]!);
}

async function post(url: string, key: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

await check("atlas", async () => {
  env("MONGODB_URI");
  const { client, connect } = await import("../apps/worker/src/db.ts");
  try {
    const db = await connect();
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
    const listed = names.length ? names.join(", ") : "none yet (run npm run setup:indexes)";
    return `writer connected to "${db.databaseName}"; collections: ${listed}`;
  } finally {
    await client.close();
  }
});

await check("reader", async () => {
  const [uri] = env("MONGODB_URI_READER");
  const client = new MongoClient(uri, { appName: "board-forge-green-check" });
  try {
    const db = client.db(process.env.MONGODB_DB || "boardforge");
    await db.command({ ping: 1 });
    try {
      await db.collection("_green_check").insertOne({ ts: new Date() });
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 13) return "reads ok, writes refused (one-writer rule holds)";
      throw err;
    }
    await db.collection("_green_check").drop();
    throw new Error("reader user can WRITE; give it only the read role on the database");
  } finally {
    await client.close();
  }
});

await check("voyage", async () => {
  const [key] = env("VOYAGE_API_KEY");
  const model = process.env.VOYAGE_MODEL || "voyage-4";
  const dims = Number(process.env.VOYAGE_DIMS || 1024);
  const emb = await post("https://api.voyageai.com/v1/embeddings", key, {
    input: ["decoupling cap near MCU power pin"],
    model,
    input_type: "document",
  });
  const len = emb.data[0].embedding.length;
  if (len !== dims) throw new Error(`${model} returned ${len} dims but vector indexes expect ${dims}`);
  const rr = await post("https://api.voyageai.com/v1/rerank", key, {
    query: "I2C pull-ups",
    documents: ["100nF cap per IC", "I2C lines need pull-ups"],
    model: "rerank-2.5",
  });
  if (rr.data[0].index !== 1) throw new Error("rerank put the wrong document first");
  return `${model} embedding (${len} dims) and rerank-2.5 ok`;
});

await check("models", async () => {
  const [key, project] = env("OPENROUTER_API_KEY", "LANGSMITH_API_KEY", "LANGSMITH_PROJECT");
  if (process.env.LANGSMITH_TRACING !== "true") throw new Error("set LANGSMITH_TRACING=true or no traces are sent");
  // Cheap model only: the team shares a $100 OpenRouter budget.
  const model = process.env.OPENROUTER_CHECK_MODEL || "google/gemini-3.8-flash";
  const langsmith = new LangSmith();
  const call = traceable(
    (prompt: string) =>
      post("https://openrouter.ai/api/v1/chat/completions", key, {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
        usage: { include: true },
      }),
    { name: "green-check", run_type: "llm", client: langsmith, project_name: project },
  );
  const res = await call("Reply with the single word: ok");
  const reply = String(res.choices?.[0]?.message?.content ?? "").trim().slice(0, 20);
  const cost = Number(res.usage?.cost ?? 0);

  await langsmith.awaitPendingTraceBatches();
  let seen = 0;
  const since = new Date(Date.now() - 5 * 60_000);
  for await (const _ of langsmith.listRuns({ projectName: project, startTime: since, isRoot: true, limit: 10 })) seen++;
  if (!seen) throw new Error(`${model} replied "${reply}" but no trace in LangSmith "${project}" yet (retry shortly)`);
  return `${model} replied "${reply}" ($${cost.toFixed(5)}); trace visible in LangSmith "${project}"`;
});

console.log(failed ? `\n${failed} check(s) failed` : "\nall green");
process.exit(failed ? 1 : 0);
