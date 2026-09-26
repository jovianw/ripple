# Ripple: Design Doc

> A self-improving harness that designs circuit boards from a spec, checks them against a hidden spec it never sees, and redesigns itself based on what fails.
>
> Built at the MongoDB Harness Engineering & Model Wrangling Hackathon, Sept 26, 2026.

**Thesis:** the model doesn't get smarter; the harness does.

---

## 1. Overview

Ripple has two layers.

- **The harness** turns an English spec (for example, "read a temperature sensor over I2C, powered from USB-C, with a status LED") into a routed PCB written in [tscircuit](https://tscircuit.com). Agents plan, write, and repair the board; deterministic tools compile, autoroute, and check it; verified subcircuits go into a reusable library.
- **The meta-harness** treats the harness itself as something to optimize. It runs batches of specs, reads the failures, proposes changes to the harness config (rules, context policy, tool access, workflow, model routing), and keeps a change only if scores improve on the next batch.

MongoDB Atlas is the memory and state layer for both: every spec, board, subcircuit, run, lesson, and harness config version lives there.

### Problem statements

| Statement | How Ripple addresses it |
|---|---|
| **One: Recursive Harnessing** | The harness config is a versioned document. A meta-agent rewrites its rules, context policy, tool access, workflow, and model routing; a config gate keeps, rolls back, or rejects each change. |
| **Two: Long Horizon Engineering** | Large boards are split into a work queue of subcircuits, built and verified step by step, checkpointed throughout, and resumable after a crash. Context never grows: every call is rebuilt from Atlas. |

---

## 2. Goals

### Hackathon goals
1. A working end-to-end loop: spec in, routed PCB out, graded by hidden checks.
2. A harness config that measurably improves itself across generations, with changes that were kept, rolled back, and rejected all visible.
3. An ablation showing the same model performing better under the evolved harness than with no harness or the v0 harness, on held-out specs.
4. A long-horizon finale board built from a work queue that survives a kill-and-restart.
5. A 3-minute live demo and a 1-minute submission video.

### Product goals
- Catch the mistakes behind most first-board respins (missing pull-ups, missing decoupling, unconnected pins, routing errors) before manufacturing.
- Make each new board cheaper to design than the last through a growing subcircuit library and learned lessons.
- Keep every design decision traceable to the rule, lesson, or config version that caused it.

### Non-goals
- Proving a board works on real hardware. The checks prove spec and rule compliance, not function.
- High-speed or signal-integrity-sensitive designs.
- Boards beyond 2 layers or roughly 20 parts.
- Training or fine-tuning models.

---

## 3. Architecture

```mermaid
flowchart LR
  UI[Next.js UI] -->|spec, reads| DB[(MongoDB Atlas)]
  W[Harness worker] <-->|state, memory, queue| DB
  W --> R[Model router] --> OR[OpenRouter]
  W --> V[Voyage AI: embed + rerank]
  W --> TS[tscircuit: compile, autoroute, DRC]
  W --> CK[Hidden checker]
  W --> LS[LangSmith traces]
  M[MongoDB MCP server, read-only] --> DB
  W -. critic and meta-agent tools .-> M
```

- **One writer:** only the worker writes design state. The UI and MCP server use a read-only database user.
- **Hidden checks** live in `checks/` files, never in the database, so neither the agents nor the read-only user can see them.
- **Live updates:** the local demo server streams Atlas change streams to the UI; the Vercel deployment polls instead, because serverless functions can't hold a stream open.

### Agents

| Agent | Job | Model tier | Triggered by |
|---|---|---|---|
| Planner | Splits a spec into subcircuits and orders the work queue | Strong | New spec, or a repair budget running out |
| Coder | Writes tscircuit code for one work item, reusing library subcircuits | Cheap | Queue item ready, or a critic fix |
| Critic | Diagnoses failures, proposes the smallest fix, writes lessons | Strong | A run failing any check |
| Meta-agent | Proposes harness config changes from batch results | Strong | A batch of boards finishing |

Deterministic components: checker, tscircuit compiler and autorouter, metrics, config gate, model router, worker and work queue, assembler.

### The design loop
1. Retrieve relevant subcircuits and lessons (Vector Search + rerank).
2. Coder writes tscircuit code.
3. Compile to Circuit JSON; autoroute; run DRC.
4. Hidden checker grades connectivity, design rules, and (optionally) SPICE.
5. On failure, the critic proposes a fix, up to the repair budget.
6. On success, save the subcircuit to the library; the assembler combines finished items.

### The meta-harness loop
1. Run a batch of training specs under the current config.
2. Meta-agent reads failures and proposes a config change with a rationale.
3. Config gate tests it on the next batch: **kept** if scores improve, **rolled back** if they drop, **rejected** if it weakens a check.
4. Every version, score, and verdict is stored in `harness_versions`.
5. Ablation on held-out specs: bare model vs. v0 vs. evolved.

### What the harness config controls

| Component | Example change |
|---|---|
| Rules and guardrails | Add "I2C lines need pull-up resistors" |
| Context policy | Retrieve 2 subcircuits instead of 5 |
| Tool access | Block autorouting until connectivity passes; grant or revoke read-only MCP tools per agent |
| Workflow | Plan first for boards over 12 parts |
| Repair budget | 3 attempts before escalating to the planner |
| Model routing | Cheap model codes; strong model critiques and plans |

---

## 4. Data model (MongoDB Atlas)

| Collection | One document is | Notes |
|---|---|---|
| `harness_versions` | a harness config | version, parent, scores, verdict, rationale |
| `specs` | a board task | spec text, train or held-out split; no check contents |
| `subcircuits` | a verified building block | code, embedding, checks passed, reuse count; vector index |
| `boards` | a board version | code, Circuit JSON, metrics, harness version, subcircuits used |
| `work_queue` | a step of a large board | status, dependencies, heartbeat |
| `runs` | one call or tool result | structured result, cost, model; the replayable trace; vector index on failures |
| `lessons` | a learned design rule | pattern, fix, embedding, how often it helped; vector index |

Atlas features used: Vector Search (memory and retrieval), versioned documents (config evolution and rollback), change streams (triggering the critic and meta-agent), multi-document transactions and idempotent upserts (crash-safe work queue).

If the Sandbox is an M0 cluster: at most 3 vector indexes (`subcircuits`, `lessons`, `runs`), and batch writes during the ablation (100 ops/sec limit).

### Contracts (frozen at kickoff)

<details>
<summary><code>HarnessConfig</code></summary>

```json
{
  "version": 4,
  "parent": 3,
  "rules": ["I2C lines need pull-up resistors"],
  "context": { "subcircuits_k": 2, "lessons_k": 5, "rerank": true, "include_last_failure": true },
  "tools": { "route_requires_connectivity": true, "parts_whitelist": "v2",
             "mcp": { "critic": ["find", "aggregate"], "meta": ["find", "aggregate"], "coder": [] } },
  "workflow": { "plan_first": true, "repair_budget": 3, "split_over_parts": 12 },
  "routing": { "planner": "strong", "coder": "cheap", "critic": "strong", "meta": "strong" },
  "scores": { "checks_passed": 0.82, "attempts_per_board": 2.4, "cost_per_board_usd": 0.31 },
  "verdict": "kept",
  "rationale": "Missing pull-ups caused 4 of 9 failures in batch 3"
}
```
</details>

<details>
<summary><code>RunResult</code></summary>

```json
{
  "board_id": "b_017",
  "harness_version": 4,
  "stage": "checks",
  "passed": false,
  "failures": [{ "check": "decoupling", "detail": "U2 VDD has no cap within 3mm" }],
  "drc_errors": 0,
  "metrics": { "area_mm2": 812, "vias": 6, "trace_mm": 214, "bom_usd": 4.12 },
  "model": "cheap",
  "tokens": 5120,
  "cost_usd": 0.004,
  "ts": "2026-09-26T13:12:05Z"
}
```
</details>

Values are illustrative.

---

## 5. Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript on Node 22.13+ |
| PCB toolchain | tscircuit (pinned version) |
| Agent loop | Vercel AI SDK (or LangGraph.js if chosen at kickoff) |
| Models | OpenRouter, routed per agent by the harness config |
| Embeddings and rerank | Voyage AI |
| Database | MongoDB Atlas Hackathon Sandbox |
| Agent data access | MongoDB MCP server, read-only |
| Tracing | LangSmith, plus `runs` in Atlas |
| UI | Next.js (scaffolded with v0), deployed on Vercel |

### Repo layout

```
ripple/
  apps/
    worker/        # harness: agents/, tools/, harness/, db.ts
    web/           # Next.js UI
  checks/          # hidden checker and check definitions (agents never read)
  packages/types/  # HarnessConfig, RunResult, Board, Lesson
  specs/           # public spec text only
  scripts/         # index setup, seed data, ablation runner
  .env.example
```

### Environment

```
MONGODB_URI=                 # writer user, worker only
MONGODB_URI_READER=          # reader user, web + MCP
MONGODB_DB=ripple
MDB_MCP_CONNECTION_STRING=   # same as reader
OPENROUTER_API_KEY=
VOYAGE_API_KEY=
VOYAGE_MODEL=
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=ripple
```

`.env`, `.mcp.json`, and editor MCP config folders are in `.gitignore`.

---

## 5b. Deliverables

Every finished board ships as files, not just a picture. `buildDeliverables(circuitJson)` (`apps/worker/src/export/`, `npm run export <board>`) produces:

| Deliverable | For |
|---|---|
| Gerber layers + Excellon drill (`fabrication/`, also `<name>-gerbers.zip`) | Ordering the board from a board house |
| BOM with part numbers, pick-and-place, assembly drawing (`assembly/`) | Sourcing and assembly |
| KiCad project: `.kicad_pro`, `.kicad_sch`, `.kicad_pcb` (`kicad/`) | Opening and editing in KiCad |
| 3D model (`3d/<name>.glb`) | 3D viewer |
| PCB and schematic images, SVG + PNG (`images/`) | Previews, report, video |
| Netlist (`netlist.csv`), SPICE netlist (`simulation/`) | Review, simulation |
| Circuit JSON and tscircuit source (`design/`) | Re-rendering, the "why?" view |
| Design report (`report.md`, `report.json`) | Spec, check results, metrics, grouped BOM, file index, limits |
| `manifest.json` | File list with categories and MIME types, for the front end |

---

## 6. Tasks

Times are for Sept 26. Checkpoints are shared; everything else has one owner.

| Owner | Area |
|---|---|
| Marcos | Hardware logic: specs, hidden checker, critic, planner, finale board; presents the demo |
| Jovian | Harness core: Atlas, config versioning and gate, memory and retrieval, work queue |
| Arjun | Agents and tools: tscircuit wrappers, model router, coder, MCP access, meta-agent, ablation |
| Jack | Front end: UI, PCB preview, Vercel deploys, README, video and submission |

### Everyone
- [x] **10:30–11:15** Kickoff: repo, pinned versions, decisions table, freeze `HarnessConfig` and `RunResult`, index setup, green check (`npm run green` all green)
- [x] **12:30** Checkpoint: one board goes spec → routed PCB → passes hidden checks under a stored config version (`t01_led_indicator`, cheap model, 1 attempt, `apps/worker/src/agents/coder-loop.ts` `runBoard`; `RunResult` stored in `runs`, subcircuit credited to the library)
- [ ] **3:30** Feature freeze; record a full backup run
- [ ] **3:30–4:30** Polish and rehearse the demo twice
- [ ] **4:30–5:00** Record the 1-minute video on site and submit

### Marcos: hardware logic, critic, planner, demo
- [ ] **Before 10:30** Install tscircuit on every laptop; build an LED-plus-resistor board through the autorouter (`npm run smoke`; done on Marcos's laptop)
- [ ] 10-minute PCB primer for the team at kickoff
- [x] **11:00–12:30** 8 training and 4 held-out specs (`specs/specs.json`); hidden checker returning `RunResult` (`checks/`, `npm run test:checks`); reference board per spec
- [x] **12:30–1:30** Critic agent (code and prompt) and lesson extraction into Atlas (`apps/worker/src/agents/critic/`: strict JSON output, lesson quality gate, no lessons from held-out specs; `npm run try:critic`. Takes Arjun's router as `complete` and Jovian's `addLesson`)
- [x] **1:30–2:30** Planner agent (`apps/worker/src/agents/planner/`: returns work items for `queue.enqueue`, validated in code, honors `plan_first` and `split_over_parts`, replans keep done items; `checkInterface` for step checks; `npm run test:planner`, `npm run try:planner`)
- [x] Assembler (`apps/worker/src/assembler/`, `npm run test:assembler`)
- [x] Parts whitelist (`parts/whitelist.json` v2, `npm run verify:parts`)
- [x] Finale board spec (`specs/finale.json`), checks, and 20-part reference board in three groups (`npm run smoke finale`)
- [x] Board deliverables export (§5b; `npm run export <board>`, `npm run test:export`)
- [x] First lesson review: 12 lessons, retired 3 (a harmful 1mm rule and 2 duplicates) with `npm run lessons`; critic prompt now uses the failure's numbers, never adds routing constraints, and fixes placement before routing errors
- [x] Finale queue handler (`apps/worker/src/pipeline/planned-board.ts`): planner items → coder per subcircuit → route + DRC + `checkInterface` → assembler + hidden checks → deliverables, on `enqueue`/`runQueue`
- [x] Dry run with stand-in planner + coder (`npm run finale -- --stub`): killed with `kill -9` mid-step, resumed, every step ran once, final board passed the finale's hidden checks
- [ ] **2:30–3:30** Finale first full run through the work queue with the real coder (`npm run finale`); needs Arjun's `complete` adapter for the planner
- [ ] Present the live demo

### Jovian: harness core and memory
- [x] Repo layout, `.env.example`, shared types package (done before kickoff)
- [x] **10:30–11:00** `db.ts`, index setup script; LangGraph go/no-go by 11:00 (`npm run setup:indexes`, `npm run green`; LangGraph: took the default, own transactions)
- [x] **11:00–12:00** Config versioning: `harness_versions`, current config, propose (`apps/worker/src/harness/config.ts`: `currentConfig`, `getConfig`, `history`, `propose`; v0 seeded with `npm run seed:config`)
- [x] **12:00–1:00** Memory: Voyage embeddings, vector indexes, retrieval and rerank (`apps/worker/src/harness/memory.ts`: `addLesson`/`retrieveLessons`, `addSubcircuit`/`retrieveSubcircuits`, `indexFailure`/`similarFailures`; k and rerank come from `config.context`)
- [x] **1:00–2:00** Work queue, transactions, idempotent runs, heartbeat, resume (`apps/worker/src/harness/queue.ts`: `enqueue`, `runQueue(boardId, handler)`, `complete`/`fail` in transactions; kill-and-resume verified with `npm run queue:demo`)
- [x] **2:00–3:00** Config gate (keep, roll back, reject); change-stream triggers for critic and meta-agent (gate: `apps/worker/src/harness/gate.ts`, `scoreVersion` + `evaluatePending(runBatch)` + guardrails; `npm run evolve` runs batch → meta-agent → gate. Change streams: no worker triggers, since the loop calls the critic and evolve calls the meta-agent directly; used for the UI's live run feed, see `docs/frontend-backend.md`)
- [ ] **3:00–3:30** Help run the finale board through the queue with kill-and-resume

### Arjun: agents, tools, models
- [x] **10:30–11:30** Tool wrappers: compile, evaluate, DRC, metrics → `CircuitJson` (`apps/worker/src/tools/{compile,evaluate,drc,metrics}.ts`; `renderUntilSettled` autoroutes, no separate autoroute step needed)
- [x] **11:30–12:30** Model router (OpenRouter, cost logging via `usage.include`, LangSmith tracing) and coder agent (`apps/worker/src/tools/router.ts`: `callModel`, `createComplete` for the critic/planner's JSON-schema `complete`; `apps/worker/src/agents/coder.ts`)
- [x] **12:30–1:00** Connect to the hidden checker for the checkpoint (`apps/worker/src/agents/coder-loop.ts`: `runBoard`/`runBatch` call `checks/index.ts`'s `runChecks`, store `RunResult`, retry through the critic up to `repair_budget`)
- [ ] **1:00–2:00** Read-only MCP access for the critic and meta-agent
- [x] **2:00–3:00** Meta-agent: batch results → proposed config change (`apps/worker/src/agents/meta.ts`: `proposeFromBatch(results, config)`, structured JSON output via `createComplete`, calls Jovian's `propose()`; never applies anything itself)
- [x] **3:00–3:30** Ablation runner on held-out specs (`scripts/ablation.ts`, `npm run ablation`: bare model vs. harness v0 vs. evolved config, `writeMemory: false`)

### Jack: front end, preview, submission
- [ ] **10:30–11:00** Redeem v0 credits; scaffold Next.js on fixture data
- [ ] **11:00–12:30** Spec input, PCB and schematic view, live run feed (fixtures)
- [ ] **12:30–1:30** Local change-stream route; Vercel deployment with polling and preview deploys per PR; switch to real data
- [ ] **1:30–2:30** Config diff viewer, ablation table, "why?" trace view
- [ ] **Deliverables panel** on each board page (§5b, `apps/worker/src/export/README.md`): API route that builds deliverables from the board's `circuit_json`; "Download all" (zip) and "Download Gerbers" buttons; PCB and schematic previews; 3D viewer for the `.glb`; BOM table; rendered `report.md`; file list from `manifest.json`
- [ ] **2:30–3:30** README, project description, demo script
- [ ] **4:30–5:00** Lead video recording and submission

### Who does what after 1:25 (no overlaps; freeze at 3:30)

State at 1:25: everything is merged and `main` typechecks. `npm run green`, `smoke`, `test:*`, `queue:demo`, and
`finale -- --stub` all pass (Windows too, after `.gitattributes`). `npm run evolve` works end to end: its first round
rolled back "coder → strong" (0% pass at 37× cost). The critic has written 12 lessons (several near-duplicates). The web
app reads Atlas at `/live`. It still can't submit a spec (read-only), and Vercel is missing its env vars.

**Jovian**
1. Vercel env vars `MONGODB_URI_READER`, `MONGODB_DB`, then redeploy (Jovian only).
2. Spec requests: `spec_requests` collection + `npm run worker`, which watches it with a change stream, claims requests
   atomically, and runs `runBoard` (or the finale pipeline for `finale`), writing `status` and `board_id` back. Resumes
   unfinished requests on restart. Contract documented in `docs/frontend-backend.md`. Atlas: a `ripple_requester` user
   with a custom role limited to insert/find on `ripple.spec_requests`.
3. Lesson dedupe in `addLesson`: a lesson that nearly matches an existing one updates it instead of adding another.
4. When Arjun's item 1 lands: `npm run evolve -- --rounds 2` on all training specs, aiming for a kept version with a new rule.

**Arjun**
1. Meta-agent input: put the most common failure *details* and the critic's new lessons into `summarizeBatch`, so it
   proposes rules (which the gate can keep), not just a bigger model.
2. Coder prompt: whitelist parts as `<chip name="U1" {...part.props} />`, never the part id as a JSX element
   (`<temp_sensor_lm75>` failed in evolve).
3. Ad-hoc specs: `runBoard` for free text with no spec id, graded on compile + DRC only and marked ungraded (for a
   judge typing their own spec).
4. After Jovian's evolve produces a kept version: `npm run ablation` (stores to `ablations`).

**Marcos**
1. One live `npm run finale` with the real planner and coder; kill it mid-run, resume, confirm it passes.
2. Check the lessons after Jovian's dedupe against the critic's quality gate.
3. 3:00: finale kill-and-resume rehearsal with Jovian; the demo script for the 3-minute run.

**Jack**
1. Prompt box → `POST /api/spec` that inserts `{ spec_id | text, status: "queued", created_at }` into `spec_requests`
   using `MONGODB_URI_REQUESTS` (the `ripple_requester` user; server-side only). Show the request's `status` and link to
   its `board_id` in `/live`.
2. Config diff and ablation views from `harness_versions` / `ablations`.

### Who does what after 12:30 (no overlaps)

State at 12:35: all pieces of the single-board loop are on `main`, but the 12:30 checkpoint has not passed yet. The only attempt (12:19) failed on the JLCPCB LED polarity DRC error, which `388dc2d` (parts engine off) fixed afterwards. Not wired yet: critic, router `complete` adapter, config passed into the loop.

**Arjun** (critical path)
1. Rerun the checkpoint on one training spec with the cheap model; tick the 12:30 checkpoint when a board passes.
2. Router adapter `complete(system, user, schema)` with JSON output. The critic and the planner both take it.
3. Wire the critic into the loop: on failure, `runCritic(..., { complete, addLesson })`; its diagnosis goes into the next attempt.
4. Loop takes the config: `runBoard(specId, config, opts)` and `runBatch(specIds, config)`. This is the only batch runner; the config gate and the ablation both call it.
5. Meta-agent: batch failures → `propose()` from `harness/config.ts`.
6. Ablation: `runBatch` on held-out specs for v0 and the evolved config, with `writeMemory: false`. Read-only MCP access last.

**Jovian** (scores and decides; never runs models)
1. `scoreVersion(version)`: aggregates `runs` into `checks_passed`, `attempts_per_board`, `cost_per_board_usd`. The gate and the ablation table both use it; don't write a second one.
2. Config gate `evaluatePending(runBatch)`: runs the pending version through the injected `runBatch`, scores it, compares with its parent; kept, rolled back, or rejected (removes a rule, gives the coder MCP tools, turns off connectivity-before-route, etc.).
3. Change streams: meta-agent trigger when a batch finishes, and a runs feed helper for the UI. No critic trigger: the loop calls the critic directly.
4. 3:00: help run the finale through the queue with kill-and-resume.

**Marcos**
1. Finale queue handler: planner work items → `runCoder` per subcircuit → `checkInterface` → assembler, driven by `enqueue`/`runQueue`. Only Marcos builds this; it's where planner, coder, checker and assembler meet.
2. Review Arjun's `complete` adapter against the critic schema; check the first lessons meet the quality gate.
3. Dry-run the finale through the queue early (a stub coder is fine) so kill-and-resume is proven before the 3:30 freeze.

**Interfaces**
| Owner | Provides | Used by |
|---|---|---|
| Arjun | `complete(system, user, schema)` | critic, planner |
| Arjun | `runBoard(specId, config, opts)`, `runBatch(specIds, config)` | config gate, ablation, meta-agent |
| Jovian | `scoreVersion(version)`, `evaluatePending(runBatch)` | ablation table, meta-agent loop, UI |
| Jovian | `enqueue`, `runQueue`, memory, `propose` (see `apps/worker/src/harness/README.md`) | Marcos, Arjun |
| Marcos | finale queue handler | finale demo |

### Handoffs
| By | From → To | What |
|---|---|---|
| 11:00 | Arjun → all | `RunResult` shape from tool wrappers |
| 12:30 | Marcos → Arjun | Hidden checker callable as a function |
| 1:00 | Jovian → Arjun, Marcos | Retrieval for coder and critic |
| 2:00 | Jovian → Arjun | Config versioning and gate for the meta-agent |
| 3:00 | Arjun → Jack | Ablation results |

### Priorities if time runs short
1. **Must have:** loop with hidden checks, subcircuit library, lessons retrieved from memory, versioned config
2. **High value:** meta-agent evolving the config; ablation table
3. **Strong bonus:** finale board with kill-and-resume
4. **Nice to have:** cheap-model-vs-frontier ablation row; "why?" trace view; Strands Harness Optimizer as an ablation baseline

---

## 7. Evaluation

| Metric | Source |
|---|---|
| Hidden checks passed per board | Checker |
| Attempts per board | `runs` |
| Board area, vias, trace length | Circuit JSON |
| Cost per board | BOM + model cost logging |
| Config changes kept / rolled back / rejected | `harness_versions` |

**Ablation** (same model, held-out specs):

| Setup | Checks passed | Attempts per board | Cost per board |
|---|---|---|---|
| Bare model, no harness | | | |
| Harness v0 | | | |
| Harness vN (evolved) | | | |
| Cheap model + vN vs. frontier model, no harness (optional) | | | |

---

## 8. Demo (3 minutes, live)

| Time | On screen | Point |
|---|---|---|
| 0:00–0:40 | Judge's spec; first attempt fails a hidden check; lesson and fix appear | It checks itself against specs it can't see |
| 0:40–1:20 | Config diff, including a rejected change | The harness evolves, with guardrails |
| 1:20–2:00 | Ablation table | The harness is doing the work |
| 2:00–2:40 | Finale board from the queue; kill the worker, restart, it resumes; download its Gerbers, BOM and KiCad project | Long horizon, durability, and a manufacturable result |
| 2:40–3:00 | "The model didn't get smarter. The harness did." | The thesis |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Evolved config doesn't beat v0 | Show the gate's rollbacks and rejections honestly; v0 still beats the bare model |
| Ablation too slow | 4–6 held-out specs, parallel runs, cached compiles |
| tscircuit changes break things | Pin the version; turn off "Force Latest @tscircuit/eval" in the preview |
| Autorouter slow or failing | 2 layers, under ~20 parts; cache routed results |
| Nonexistent parts or footprints | Whitelist of known-good parts |
| Clean checks, board wouldn't work | Stated as a non-goal; checks target the most common real-world mistakes |
| M0 limits | 3 vector indexes; batched writes |

---

## 10. Open decisions

| Decision | Deadline | Default |
|---|---|---|
| Strands SDK for the inner agents vs. own loop | Kickoff | Own TypeScript loop, unless someone has built with Strands before |
| LangGraph checkpointer vs. own transactions | 11:00 | Own transactions |
| Atlas Automated Embeddings vs. Voyage API | 20 min of trying | Voyage API |
| Cheap and strong models | 11:00 | One fast cheap model, one frontier model on OpenRouter |
| Who attends MongoDB.local (Sept 30, 10 AM–4:30 PM) if we're top 6 | Today | — |

### Related work
[Strands Harness Optimizer](https://github.com/strands-labs/harness-optimizer) tunes an agent's context (system prompt, tool docs, skills) from rollouts and rewards. Ripple evolves the whole harness, including tool access, workflow, repair budgets, and model routing; refuses changes that weaken its own checks; keeps every version in Atlas; and runs long jobs that survive a crash.

---

## 11. Submission checklist
- [ ] Public GitHub repo; `.env` and MCP config not committed
- [ ] 1-minute demo video recorded on site, with working audio
- [ ] Concise project description
- [ ] All four teammates added to the Cerebral Valley submission
- [ ] Demo link (Vercel) opens for anyone
- [ ] Built in the MongoDB Atlas Hackathon Sandbox; all work written today
- [ ] Finalist attendee confirmed for MongoDB.local, Sept 30, 10 AM–4:30 PM
- [ ] LangSmith credits redeemed within 10 days
