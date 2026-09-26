# Harness core: Atlas, config, memory, work queue

Owner: Jovian. This is the reference for everything under `apps/worker/src/db.ts` and `apps/worker/src/harness/`.
If you're writing an agent, a tool, or the UI and need Atlas, harness config, memory or the queue, use these functions
instead of querying the collections yourself, and ask Jovian before changing them.

Imports inside the worker use NodeNext paths with a `.js` extension, e.g. `import { currentConfig } from "../harness/config.js"`.
Scripts under `scripts/` import the `.ts` files directly (`../apps/worker/src/harness/config.ts`).

## Rules that these APIs enforce

- **One writer.** Only worker code writes to Atlas, through `db.ts` (`MONGODB_URI`, the writer user). The web app and MCP
  server use `MONGODB_URI_READER`, which Atlas refuses writes from.
- **Configs are never edited in place.** Every change is a new version via `propose()`; `currentConfig()` is what a run uses.
- **Every run records the config version it used** (`RunResult.harness_version = (await currentConfig()).version`).
- **Hidden checks never go into Atlas or memory.** Don't store `checks/` content in lessons, subcircuits or runs.
- **Embed descriptions, not code.** Memory text should read the way a spec or failure would describe it.

## Setup and scripts

| Command | Does |
|---|---|
| `npm run setup:indexes` | Creates collections, regular indexes and the 3 vector indexes. Safe to re-run. Already done on our cluster. |
| `npm run seed:config` | Inserts harness config v0 if missing and prints the current config. Safe to re-run. Already done. |
| `npm run green` | Checks writer, read-only reader, Voyage, and one cheap OpenRouter call traced in LangSmith. `npm run green -- voyage` runs one check. |
| `npm run queue:demo` | Kill-and-resume demo on a finale-shaped board with a stand-in handler. `-- --reset` starts over. Ctrl+C mid-run, rerun, it resumes. |
| `npm run worker` | Serves spec requests from the web app (change stream on `spec_requests`). Ctrl+C stops; restart resumes. |
| `npm run evolve` | Batch → meta-agent proposal → gate decision, per round. `-- --rounds 3`, `-- --specs t04_...,t08_...`. Spends model budget. |

Env: `MONGODB_URI`, `MONGODB_DB=ripple`, `VOYAGE_API_KEY`, optional `VOYAGE_MODEL` (default `voyage-4`, 1024 dims),
`VOYAGE_RERANK_MODEL` (default `rerank-2.5`), optional `WORKER_ID` (default `worker-<hostname>`).

## `db.ts`: Atlas client and collections

```ts
import { client, db, col, connect } from "../db.js";
await connect(); // once per process; pings so a bad URI or IP allowlist fails fast
```

| `col.` | Collection | One document is | Shape |
|---|---|---|---|
| `harness` | `harness_versions` | a harness config version | `HarnessConfig` (frozen contract) |
| `specs` | `specs` | a board task | untyped for now |
| `subcircuits` | `subcircuits` | a verified building block | `Subcircuit` + `description`, `created_at` |
| `boards` | `boards` | a board version | untyped for now (`Board` draft in `@ripple/types`) |
| `queue` | `work_queue` | a step of a board | `WorkItem` + queue fields (see below) |
| `runs` | `runs` | one model call or tool result | `RunResult` (frozen) + optional `_id`, `embedding`, `failure_summary` |
| `lessons` | `lessons` | a learned design rule | `Lesson` + `active`, `created_at` |

Vector indexes (all on field `embedding`, 1024 dims, cosine): `subcircuits_vec`, `lessons_vec` (filter `active`),
`runs_vec` (filters `passed`, `harness_version`). Regular indexes: `harness_versions.version` (unique), `specs.spec_id`
(unique), `boards {board_id, version}`, `work_queue {status, board_id}`, `runs {board_id, ts}`, `runs {harness_version, passed}`.

## `harness/config.ts`: versioned harness config

| Function | Returns | Use it for |
|---|---|---|
| `currentConfig()` | `HarnessConfig` | The config every run uses: the newest version with verdict `"kept"`. Read it at the start of each board. |
| `getConfig(version)` | `HarnessConfig \| null` | Look up the config a past run used. |
| `history()` | `HarnessConfig[]` | Every version oldest first, including `pending`, `rolled_back` and `rejected`. For the config diff view. |
| `propose(change, rationale)` | `HarnessConfig` | Meta-agent: store a change as a new `"pending"` version on top of the current one. |
| `seedBaseline()` / `BASELINE` | | v0: the loop plus checks, no learned rules. Used by `npm run seed:config` and the ablation. |

`change` is a `ConfigChange`: any of `rules`, `context`, `tools` (incl. `tools.mcp`), `workflow`, `routing`. Sections merge
into the current config, so `{ context: { lessons_k: 3 } }` keeps every other context field. `rules` replaces the list, so
send the full list you want. `version`, `parent`, `verdict` and `scores` can't be set through `propose`.

```ts
const next = await propose(
  { rules: [...cur.rules, "I2C lines need pull-up resistors"], context: { lessons_k: 3 } },
  "Missing pull-ups caused 4 of 9 failures in batch 3",
);
// next.version is new, next.parent === cur.version, next.verdict === "pending"
```

Verdicts: `"kept"` (current if newest), `"pending"` (proposed, not yet scored), `"rolled_back"` (scored worse),
`"rejected"` (breaks a guardrail). `harness/gate.ts` sets them (below); proposals stay `pending` and `currentConfig()`
doesn't change until the gate runs.

## `harness/gate.ts`: scoring and the config gate

The gate never calls models. Arjun's batch runner is passed in, so the same scoring serves the gate, the ablation table and
the UI.

| Function | Who calls it | Notes |
|---|---|---|
| `scoreVersion(version, { boardIds? })` → `Scores \| null` | ablation, UI, gate | From `runs` with that `harness_version`. Per board: passed if any attempt passed; attempts = runs with `stage: "checks"`; cost = sum of every run's `cost_usd`. Averaged over boards: `{ checks_passed, attempts_per_board, cost_per_board_usd, boards }`. `checks_passed` is the share of boards that passed all hidden checks. |
| `evaluatePending(runBatch)` → `GateDecision \| null` | meta-agent loop, after each `propose()` | Takes the oldest `pending` version. Guardrail violation → `"rejected"` with no batch run. Otherwise runs a batch under the parent (only if it has no scores yet) and under the candidate, then `"kept"` if `isBetter`, else `"rolled_back"`. Stores `scores`, `verdict`, `gate_note`, `decided_at` on the version. `null` when nothing is pending. |
| `guardrailViolations(parent, candidate)` → `string[]` | gate, meta-agent (to pre-check) | Rejects: removing an existing rule; turning off `route_requires_connectivity`; changing `parts_whitelist`; any MCP tools for the coder; non-read-only MCP tools for anyone; `repair_budget` outside 1..6; `split_over_parts` below 4; `lessons_k`/`subcircuits_k` outside 0..10. |
| `isBetter(candidate, parent)` | gate | More boards passing wins; tie → fewer attempts; tie → lower cost. |

`runBatch` must have this shape (it's what Arjun's `runBatch(specIds, config)` needs to provide, wrapped in a closure):

```ts
type RunBatch = (config: HarnessConfig) => Promise<{ boardIds: string[] }>;
// every run it writes has harness_version = config.version; use training specs only, never held-out ones
const decision = await evaluatePending((config) => runBatch(TRAINING_SPEC_IDS, config));
// { version, parent, verdict: "kept" | "rolled_back" | "rejected", reasons, scores?, parentScores? }
```

Meta-agent loop: `propose(change, rationale)` → `evaluatePending(...)` → read `decision.verdict` / `reasons`. Rejected and
rolled-back versions stay in `harness_versions` for the config diff view.

Pass `{ parentBoardIds }` when you already ran a batch under the parent (the evolve loop does): the parent is scored from
those boards instead of being run again.

## `npm run evolve`: the recursive-harnessing loop

`scripts/evolve.ts` ties it together, one round per `--rounds`: `runBatch` (training specs) under `currentConfig()` →
Arjun's `proposeFromBatch` (meta-agent; may propose nothing) → `evaluatePending` with a fresh test batch under the
proposal, reusing the first batch for the parent → prints the config diff and the verdict. Training specs only; held-out
specs are refused. `--specs a,b` limits the batch (cheaper while developing).

## `harness/requests.ts` + `npm run worker`: spec requests from the web app

The web app's `ripple_requester` user has `readWrite` on the `spec_requests` collection only. `serveRequests(handler)` recovers interrupted
requests (its own at restart, anyone's after a 60 s stale heartbeat), claims the oldest `queued` one atomically, runs it
with heartbeats, and writes `status` / `board_id` / `passed` / `attempts` / `error` back; new inserts wake it through a
change stream, with a 10 s poll as backup. `scripts/worker.ts` is the handler: `spec_id` from `specs/specs.json` →
Arjun's `runBoard` (held-out specs never write memory), `"finale"` → Marcos's `runPlannedBoard` with the live planner and
coder, free text → failed with a clear message until ad-hoc `runBoard` exists. A resumed request reuses its `board_id`.
Contract for the web side: `docs/frontend-backend.md` §5.

## Lesson dedupe

`addLesson` returns an existing active lesson's id instead of inserting when the new lesson's vector score against it is
≥ 0.965 (a restatement). Measured on the first critic lessons: restatements scored ~0.98, distinct I2C lessons 0.93–0.955.

## Change streams

Decided at 12:35: no change-stream triggers in the worker. Arjun's loop calls the critic directly, and `npm run evolve`
calls the meta-agent after each batch, so triggers would double-run them. Change streams are used for the UI's live run
feed (a local route handler holding a `runs` change stream; see `docs/frontend-backend.md`).

## `harness/memory.ts`: lessons, subcircuits, similar failures

Retrieval always takes the config's context policy, so the meta-agent can tune it:
`retrieveX(query, (await currentConfig()).context)`. It pulls ~20 vector hits, reranks them with Voyage if
`context.rerank` is true, and returns the top `k` (`lessons_k` or `subcircuits_k`). Results include `score` and never
include `embedding`.

| Function | Who calls it | Notes |
|---|---|---|
| `addLesson({ pattern, fix })` → `id` | critic | Same `pattern` → same id: re-learning updates instead of duplicating. |
| `retrieveLessons(query, context)` | coder (spec text), critic (failure summary) | Only `active` lessons. Returns `StoredLesson & { score }`. |
| `markLessonsHelped(ids)` | loop, when a board passes | Increments `times_helped` for lessons that were in context. |
| `addSubcircuit({ name, description, code, checks_passed })` → `id` | loop, after a subcircuit passes checks | `description` is what gets embedded; write it like a spec asks for it. Same `name` → same id. |
| `retrieveSubcircuits(query, context)` | coder, planner | Returns `StoredSubcircuit & { score }` including `code`. |
| `markSubcircuitsReused(ids)` | loop | Increments `reuse_count`. |
| `indexFailure(runId, summary)` | critic, after a failed run | Makes that run searchable by a one-line failure summary. |
| `similarFailures(summary, k, context)` | critic | Past failed runs that look like this one. |
| `embed(texts, "document" \| "query")`, `rerank(query, docs, topK)` | anything else | Raw Voyage calls; retry on 429. |

```ts
const ctx = (await currentConfig()).context;
const lessons = await retrieveLessons("U3 SDA and SCL float, no resistor to 3V3", ctx);
// lessons[0].pattern === "I2C lines need pull-up resistors", lessons[0].fix, lessons[0]._id
```

## `harness/queue.ts`: durable work queue (long-horizon boards)

A board is split into steps with dependencies. Workers claim ready steps, heartbeat while working, and finish each step in a
transaction. Kill a worker at any point and restart it: it resumes with nothing lost or duplicated.

| Function | Who calls it | Notes |
|---|---|---|
| `enqueue(boardId, items)` | planner | `items: { key, title, depends_on?: key[], payload?, max_attempts? = 3 }[]`. Array order sets `step`. Re-enqueuing the same keys is a no-op. |
| `runQueue(boardId, handler, { workerId?, log? })` | worker entry point | Recovers, then claim → `handler(item)` → commit, until nothing is left. Returns `progress()`. |
| `progress(boardId)` | UI, demo | `{ pending, running, done, failed, total, items }`. |
| `claimNext`, `heartbeat`, `complete`, `fail`, `recover` | `runQueue` | Lower-level pieces, in case you need your own loop. |
| `runId(boardId, step, attempt)` | | The deterministic `_id` the queue gives a step's run. |

The handler is where the design loop plugs in:

```ts
import { runQueue, type Handler } from "../harness/queue.js";

const handler: Handler = async (item) => {
  // item.key, item.title, item.payload, item.attempts (1 on first try), item.board_id
  const run: RunResult = { /* result of writing + compiling + checking this subcircuit */ };
  return { run, board: { /* optional board document to store in the same transaction */ } };
  // throw to fail the attempt: it retries up to max_attempts, then the item is "failed"
};
await runQueue("finale-001", handler, { log: console.log });
```

Queue item fields beyond `WorkItem` (`_id` is `"<board_id>:<key>"`): `key`, `step`, `title`, `payload`, `waiting_on`
(unfinished dependencies; the item is ready when it's empty), `attempts`, `max_attempts`, `claimed_by`, `started_at`,
`finished_at`, `error`. `heartbeat` is an ISO string refreshed every 5 s; items whose worker stops heartbeating for 30 s
are put back as pending.

