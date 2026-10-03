# Frontend ↔ backend guide

How `apps/web` reads what the worker produces. Written 12:55 on Sept 26 against what is actually in Atlas; field lists
below come from real documents. Backend owners: Jovian (Atlas, config, memory, queue, gate), Arjun (coder loop, runs,
ablation), Marcos (planner, finale pipeline, boards, deliverables). Ask them before relying on anything marked *gap*.

## 1. Connecting

- **Read-only.** The web app uses `MONGODB_URI_READER` (read role on `ripple`) and `MONGODB_DB=ripple`. Atlas refuses
  writes from this user; only the worker writes (AGENTS.md "One writer").
- **Server-side only.** Query Atlas from route handlers (`app/api/**/route.ts`) or server components, never from the
  browser. Use the `mongodb` driver and `runtime = "nodejs"`.
- **Don't import worker code** (`apps/worker/src/db.ts` needs the writer URI and throws without it). Copy the queries below.
  Types can come from `@ripple/types` (`HarnessConfig`, `RunResult`, `WorkItem`, ...).
- **Vercel:** set `MONGODB_URI_READER` and `MONGODB_DB` in the project's environment variables. Atlas network access
  allows `0.0.0.0/0` for the day, so Vercel can connect.

```ts
// apps/web/lib/db.ts (suggested)
import { MongoClient } from "mongodb";
const g = globalThis as unknown as { _mongo?: MongoClient };
export const mongo = (g._mongo ??= new MongoClient(process.env.MONGODB_URI_READER!, { appName: "ripple-web" }));
export const db = () => mongo.db(process.env.MONGODB_DB || "ripple");
```

## 2. What's where

| Collection | One document is | Written by | Web uses it for |
|---|---|---|---|
| `runs` | one attempt / tool result | Arjun's loop, Marcos's pipeline, queue | live feed, telemetry, per-board history, ablation, scores |
| `boards` | a board or subcircuit version with Circuit JSON | Marcos's finale pipeline | PCB view, deliverables |
| `work_queue` | one step of a long-horizon board | Jovian's queue | finale progress / kill-and-resume view |
| `harness_versions` | one harness config version | config + gate | config diff view, evolution history |
| `lessons` | a learned design rule | critic | "memory" panel, "why?" view |
| `subcircuits` | a verified reusable block | loop, on pass | library panel |
| `specs` | *(empty)* | — | specs live in `specs/specs.json` (`{ _id, split, text }`, 8 `train` + 4 `held_out`) and `specs/finale.json` |

Never show `checks/` content (expected checks, reference boards); it isn't in Atlas anyway. Showing a run's `failures`
is fine.

## 3. Views and their queries

### Live run feed / telemetry
```ts
db().collection("runs").find({}, { sort: { ts: -1 }, limit: 50, projection: { embedding: 0 } })
```
Run fields (`RunResult`): `_id`, `board_id`, `harness_version`, `stage` (`"checks"` = one graded attempt; also `"compile"`,
`"critique"`, `"improve_critique"`, `"improve"`, `"cache_hit"`, `"error"`, `"subcircuit"`, `"final"`), `passed`, `failures: [{ check, detail }]`, `drc_errors`,
`metrics: { area_mm2, vias, trace_mm, bom_usd }` (`bom_usd` from whitelist unit prices), `model` (`"cheap" | "strong"`),
`tokens`, `cost_usd`, `ts` (ISO string). Attempt number is the suffix of `_id` (`<board_id>_<n>`) for single boards.
Single-board runs also carry `spec_id`, `check_score` (partial credit, 0..1: share of the spec's hidden-check categories
passed), `quality` (`{ area_mm2, density, trace_mm, connections, detour, vias, parts, bom_usd }`; `detour` 1.0 = straight
lines, `density` = share of the board covered by parts) and `final: true` on the run whose board was kept (the board
that's scored). After a pass, up to 3 improve rounds: `<board_id>_improve<n>_critique` (`stage: "improve_critique"`,
`improve: { edits, expected }`: what the critic suggested to make the board smaller, more direct or cheaper) and
`<board_id>_improve<n>` (`stage: "improve"`: the edited board, graded). A round whose board still passes and is better
is kept: it gets a `boards` doc and, if it's the last kept round, `final: true`.

**Live updates:** on Vercel, poll `runs` by `ts > lastSeen` every 2 s. Locally (demo laptop) a route handler can hold a
change stream open and forward inserts as server-sent events:
```ts
const stream = db().collection("runs").watch([{ $match: { operationType: { $in: ["insert", "replace"] } } }], { fullDocument: "updateLookup" });
for await (const ev of stream) send(ev.fullDocument); // strip `embedding` before sending
```
Change streams need the long-lived local server; Vercel functions time out.

### One board's history (attempts, failures, repairs)
```ts
db().collection("runs").find({ board_id }, { sort: { ts: 1 }, projection: { embedding: 0 } })
```
Passed = any run with `passed: true`. Attempts = runs with `stage: "checks"`. Cost = sum of `cost_usd`. The kept board
= the run with `final: true` (it's the latest `boards` doc too).

### PCB view (Circuit JSON)
Only the finale pipeline stores boards today:
```ts
db().collection("boards").find({ board_id }, { sort: { created_at: 1 } })
// kind: "subcircuit" → { key, spec_id, source, group_code, created_at }        (one per finished step)
// kind: "final"      → { spec_id, harness_version, code, circuit_json, passed, failures, subcircuits_used, created_at }
```
`circuit_json` is tscircuit Circuit JSON (an array of elements). For the `PCBState` adapter in `lib/types.ts`:
`pcb_board` (`width`, `height`, mm), `pcb_component` (`center {x,y}`, `width`, `height`, `rotation`, `source_component_id`),
`source_component` (`source_component_id`, `name`, `ftype`, e.g. `simple_resistor`, `simple_chip`), `pcb_trace`
(`route: [{ x, y, width, layer, route_type }]`), `pcb_via`, and any `*_error` element (DRC readout).

*Gap (Arjun):* single boards from `runBoard` only write `runs`, not `boards`, so there's no Circuit JSON to draw for them
yet. Ask Arjun to also store `{ board_id, kind: "single", spec_id, harness_version, source, circuit_json, passed,
failures, created_at }` per attempt, same shape as the finale's final board.

### Deliverables
Already wired: `GET /api/boards/:id/deliverables` (manifest) and `?file=...`, shaped per
`apps/worker/src/export/README.md`. Today it serves a pre-generated bundle; to go live, read the `kind: "final"` board's
`circuit_json` from `boards` (the route's header comment shows how).

### Finale progress (long horizon, kill-and-resume)
```ts
db().collection("work_queue").find({ board_id }, { sort: { step: 1 } })
```
Fields: `_id` (`"<board_id>:<key>"`), `key`, `title`, `step`, `status` (`pending | running | done | failed`),
`depends_on` / `waiting_on` (item ids; ready when `waiting_on` is empty), `attempts`, `max_attempts`, `heartbeat`
(ISO, refreshed every 5 s while running), `started_at`, `finished_at`, `error`, `payload` (`{ kind, purpose, parts,
nets, ... }` for subcircuits, `{ kind: "assemble" }` for the last step).
Show a stale `heartbeat` (> 30 s on a `running` item) as "worker died, will resume"; after a restart the item goes back
to `running` with `attempts` + 1. The demo board ids are `finale-live` / `finale-dry` (`npm run finale [-- --stub]`).

### Config diff and evolution history
```ts
db().collection("harness_versions").find({}, { sort: { version: 1 } })
```
Each doc is a `HarnessConfig`: `version`, `parent`, `rules[]`, `context`, `tools`, `workflow`, `routing`, `verdict`
(`kept | pending | rolled_back | rejected`), `rationale` (the meta-agent's reason), `scores?`
(`{ checks_passed, attempts_per_board, cost_per_board_usd, check_score?, board? }`: `check_score` = mean partial credit,
`board` = mean `{ area_mm2, density, detour, vias, parts, bom_usd }` of passing boards or `null`; both absent on versions
scored before graded scoring), plus from the gate: `gate_note` (why it was kept / rolled back / rejected,
human-readable), `quality_vs_parent` (`{ ratio, shared }`: its boards vs the parent's, spec by spec, over `shared` specs
both passed; `ratio` 1.12 = 12% better, `null` = no shared spec) and `decided_at`. Diff = a version against the version named in its `parent`.
Current config = newest `kept`. Rejected and rolled-back versions stay, so show them: that's the "harness refusing bad
changes" moment.

### Scores / ablation table
Per config version, the same per-board aggregation the gate uses (`apps/worker/src/harness/gate.ts` `scoreVersion`),
then averaged over boards (`check_score` over all boards, `finals` over passing ones):
```ts
db().collection("runs").aggregate([
  { $match: { harness_version: v /*, board_id: { $in: batchBoardIds } */ } },
  { $group: { _id: "$board_id", spec_id: { $max: "$spec_id" }, passed: { $max: { $cond: ["$passed", 1, 0] } },
      attempts: { $sum: { $cond: [{ $eq: ["$stage", "checks"] }, 1, 0] } }, cost: { $sum: { $ifNull: ["$cost_usd", 0] } },
      check_score: { $max: "$check_score" },
      finals: { $push: { $cond: [{ $eq: ["$final", true] }, "$quality", "$$REMOVE"] } } } },
])
```
`ablations` rows: `{ setup, harness_version, checks_passed, total, avg_attempts, avg_cost_usd, check_score,
quality_vs_v0?, ts }` (`quality_vs_v0` on the evolved row only, same shape as `quality_vs_parent`).
*Gap (Arjun):* `npm run ablation` prints its table but doesn't store it, and the bare-model row writes no runs. Until it
stores results (e.g. an `ablations` collection: `{ setup, harness_version, checks_passed, total, avg_attempts,
avg_cost_usd, ts }`), show the printed table as fixture data. Also mixing held-out ablation runs into a version's
all-time score is misleading; filter by board ids when you can.

### Memory panels
```ts
db().collection("lessons").find({ active: true }, { sort: { times_helped: -1 }, projection: { embedding: 0 } })
// { _id, pattern, fix, times_helped, active, created_at }
db().collection("subcircuits").find({}, { sort: { reuse_count: -1 }, projection: { embedding: 0, code: 0 } })
// { _id, name, description, checks_passed[], reuse_count, created_at }  (code is large; fetch it on demand)
```
Always project out `embedding` (1024 numbers per doc).

## 4. Things the web app can't do yet

- **Submit a spec: now possible, through `spec_requests` (see §5).** The web app still never gets the writer URI.
- **"Why?" trace per decision.** Runs don't yet record which lessons or rules were in the coder's context. *Gap
  (Arjun/Jovian):* add `lessons_used: string[]` and `subcircuits_used: string[]` to the run document; until then, link a
  board to its config version's `rules` via `harness_version`.

## 5. Submitting a spec (`spec_requests`)

The prompt box inserts a request; the worker (`npm run worker`, running on the demo laptop) picks it up through an Atlas
change stream, runs it, and writes the status back. Design state is still written only by the worker.

**Connection:** a third user, `ripple_requester`, with the built-in `readWrite` role scoped to the one collection
`ripple.spec_requests` (it can't touch runs, boards, configs or lessons). Env var `MONGODB_URI_REQUESTS` (server-side only; set it in Vercel and `apps/web/.env.local`).
Keep using `MONGODB_URI_READER` for every read except request status if you prefer one client per user.

**Auth:** `POST /api/spec` requires a signed-in session (Auth.js, `apps/web/lib/auth.ts`) when auth is configured
(`MONGODB_URI_AUTH` + at least one provider's env vars set) — unauthenticated requests get `401`. On a deployment
with no auth vars set at all, the route falls back to accepting anonymous submits (no `user_id`), so the demo laptop
setup in `docs/demo.md` keeps working without sign-in. When a session exists, its user id is stored as `user_id` on
the inserted doc, and both a per-user and a global cap apply (`MAX_PENDING` / `MAX_PENDING_GLOBAL`, `apps/web/lib/requests.ts`).

**Insert** (from a route handler, e.g. `POST /api/spec`):
```ts
await requests.insertOne({
  spec_id, status: "queued", created_at: new Date().toISOString(), source: "web",
  ...(session?.user?.id ? { user_id: session.user.id } : {}),
});
// spec_id: an _id from specs/specs.json (t01_… t08_, h01_… h04_) or "finale". Free text (`text`) is rejected until
// Arjun's ad-hoc runBoard lands; offer a spec picker for now.
```

**Status** (poll every 2 s, or the same change-stream pattern as runs):
```ts
db().collection("spec_requests").findOne({ _id })
// status: "queued" → "running" → "done" | "failed"
// board_id (set as soon as it starts; join runs and boards on it), harness_version, passed, attempts,
// error (when failed, human-readable), created_at, started_at, finished_at, heartbeat (ISO, every 5 s while running)
```
If the worker dies mid-request, the request stays `running` with a stale `heartbeat`; the restarted worker resumes it
with the same `board_id`. Requests run one at a time, oldest first (model budget). The finale takes minutes; single
specs take seconds to about a minute.

**Atlas setup (Jovian, once):** Database Users → Add New Database User `ripple_requester` → Database User Privileges →
Specific Privileges → Add Specific Privilege → built-in role `readWrite`, database `ripple`, collection `spec_requests`
(nothing else). Its connection string goes in `MONGODB_URI_REQUESTS`.
