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
`"error"`, `"subcircuit"`, `"final"`), `passed`, `failures: [{ check, detail }]`, `drc_errors`,
`metrics: { area_mm2, vias, trace_mm, bom_usd }` (`bom_usd` is 0 for now), `model` (`"cheap" | "strong"`), `tokens`,
`cost_usd`, `ts` (ISO string). Attempt number is the suffix of `_id` (`<board_id>_<n>`) for single boards.

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
Passed = any run with `passed: true`. Attempts = runs with `stage: "checks"`. Cost = sum of `cost_usd`.

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
(`{ checks_passed, attempts_per_board, cost_per_board_usd }`), plus from the gate: `gate_note` (why it was kept / rolled
back / rejected, human-readable) and `decided_at`. Diff = a version against the version named in its `parent`.
Current config = newest `kept`. Rejected and rolled-back versions stay, so show them: that's the "harness refusing bad
changes" moment.

### Scores / ablation table
Per config version, the same aggregation the gate uses (`apps/worker/src/harness/gate.ts` `scoreVersion`):
```ts
db().collection("runs").aggregate([
  { $match: { harness_version: v /*, board_id: { $in: batchBoardIds } */ } },
  { $group: { _id: "$board_id", passed: { $max: { $cond: ["$passed", 1, 0] } },
      attempts: { $sum: { $cond: [{ $eq: ["$stage", "checks"] }, 1, 0] } }, cost: { $sum: { $ifNull: ["$cost_usd", 0] } } } },
  { $group: { _id: null, boards: { $sum: 1 }, checks_passed: { $avg: "$passed" },
      attempts_per_board: { $avg: "$attempts" }, cost_per_board_usd: { $avg: "$cost" } } },
])
```
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

- **Submit a spec.** The web app can't write to Atlas. For the demo, specs are run from the worker CLI (`npm run finale`,
  Arjun's batch scripts). If a live "type a spec" box is needed, ask Jovian for a small worker endpoint or a
  `spec_requests` collection written through the worker; don't give the web app the writer URI.
- **"Why?" trace per decision.** Runs don't yet record which lessons or rules were in the coder's context. *Gap
  (Arjun/Jovian):* add `lessons_used: string[]` and `subcircuits_used: string[]` to the run document; until then, link a
  board to its config version's `rules` via `harness_version`.
