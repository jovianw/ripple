// Green check (runbook step 6): every piece of the stack answers before real work starts.
//   bun run green                  all checks
//   bun run green atlas voyage     only the named checks
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, registerTelemetry } from "ai";
import { Client as LangSmith } from "langsmith";
import { LangSmithTelemetry } from "langsmith/experimental/vercel";
import { MongoClient, MongoServerError } from "mongodb";

const only = new Set(process.argv.slice(2));
let failed = 0;

async function check(name: string, fn: () => Promise<string>) {
  if (only.size && !only.has(name)) return;
  try {
    console.log(`✓ ${name.padEnd(10)} ${await fn()}`);
  } catch (err) {
    failed++;
    console.log(`✗ ${name.padEnd(10)} ${err instanceof Error ? err.message : String(err)}`);
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
  const { client, connect } = await import("../apps/worker/src/db");
  try {
    const db = await connect();
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
    const listed = names.length ? names.join(", ") : "none yet (run bun run setup:indexes)";
    return `writer connected to "${db.databaseName}"; collections: ${listed}`;
  } finally {
    await client.close();
  }
});

await check("reader", async () => {
  const [uri] = env("MONGODB_URI_READER");
  const client = new MongoClient(uri, { appName: "ripple-green-check" });
  try {
    const db = client.db(process.env.MONGODB_DB ?? "ripple");
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

await check("tscircuit", async () => {
  const r = spawnSync("bunx tsci build apps/worker/fixtures/sanity.circuit.tsx", { shell: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tsci build exited ${r.status}:\n${(r.stdout + r.stderr).trim().slice(-600)}`);
  const json: { type: string }[] = JSON.parse(readFileSync("apps/worker/dist/fixtures/sanity/circuit.json", "utf8"));
  const traces = json.filter((e) => e.type === "pcb_trace").length;
  const errors = json.filter((e) => e.type.endsWith("_error")).map((e) => e.type);
  if (!traces || errors.length) throw new Error(`routed traces: ${traces}; errors: ${errors.join(", ") || "none"}`);
  return `fixture compiled and autorouted: ${traces} routed traces, 0 errors`;
});

await check("voyage", async () => {
  const [key] = env("VOYAGE_API_KEY");
  const model = process.env.VOYAGE_MODEL ?? "voyage-4";
  const dims = Number(process.env.VOYAGE_DIMS ?? 1024);
  const emb = await post("https://api.voyageai.com/v1/embeddings", key, {
    input: ["decoupling cap near MCU power pin"],
    model,
    input_type: "document",
  });
  const len = emb.data[0].embedding.length;
  if (len !== dims) throw new Error(`${model} returned ${len} dims but VOYAGE_DIMS=${dims}; vector indexes must match`);
  const rr = await post("https://api.voyageai.com/v1/rerank", key, {
    query: "I2C pull-ups",
    documents: ["100nF cap per IC", "I2C lines need pull-ups"],
    model: process.env.VOYAGE_RERANK_MODEL ?? "rerank-2.5",
  });
  if (rr.data[0].index !== 1) throw new Error("rerank put the wrong document first");
  return `${model} embedding (${len} dims) and rerank ok`;
});

await check("models", async () => {
  const [apiKey, cheap, strong, project] = env("OPENROUTER_API_KEY", "MODEL_CHEAP", "MODEL_STRONG", "LANGSMITH_PROJECT");
  const tracing = process.env.LANGSMITH_TRACING === "true" && !!process.env.LANGSMITH_API_KEY;
  const langsmith = tracing ? new LangSmith() : undefined;
  if (langsmith) registerTelemetry(LangSmithTelemetry({ client: langsmith, projectName: project }));

  const openrouter = createOpenRouter({ apiKey });
  const lines: string[] = [];
  for (const [tier, id] of [["cheap", cheap], ["strong", strong]] as const) {
    const r = await generateText({
      model: openrouter(id, { usage: { include: true } }),
      prompt: "Reply with the single word: ok",
      maxOutputTokens: 1000,
    });
    const cost = r.providerMetadata?.openrouter?.usage as { cost?: number } | undefined;
    lines.push(`${tier}=${id} "${r.text.trim().slice(0, 20)}" $${(cost?.cost ?? 0).toFixed(5)}`);
  }
  if (!langsmith) throw new Error(`${lines.join("; ")}; but LangSmith tracing is off (set LANGSMITH_TRACING=true and LANGSMITH_API_KEY)`);

  await langsmith.awaitPendingTraceBatches();
  const since = new Date(Date.now() - 5 * 60_000);
  let seen = 0;
  for await (const _ of langsmith.listRuns({ projectName: project, startTime: since, isRoot: true, limit: 10 })) seen++;
  if (!seen) throw new Error(`${lines.join("; ")}; but no traces found in LangSmith project "${project}" yet (retry in a few seconds)`);
  return `${lines.join("; ")}; ${seen} trace(s) in LangSmith "${project}"`;
});

console.log(failed ? `\n${failed} check(s) failed` : "\nall green");
process.exit(failed ? 1 : 0);
