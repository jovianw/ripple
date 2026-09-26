# AGENTS.md

Guide for coding agents working in this repo. Read before making changes.

## Project

Ripple: a self-improving harness that designs PCBs (tscircuit) from an English spec, grades them against hidden checks, and evolves its own config. Full design: [DESIGN.md](DESIGN.md). Team brief: [docs/board_forge_pcb_brief_V2.pdf](docs/board_forge_pcb_brief_V2.pdf).

## Who owns what

Stay inside your person's area. To change another area, ask its owner.

| Owner | Area | Paths |
|---|---|---|
| Marcos | Specs, hidden checker, critic, planner, assembler, parts whitelist, finale board | `checks/`, `specs/`, `parts/`, `apps/worker/src/agents/{critic,planner}*`, assembler |
| Jovian | Atlas (`db.ts`), config versioning and gate, memory and retrieval (Voyage), work queue, change streams | `apps/worker/src/db.ts`, `apps/worker/src/harness/`, `scripts/` (index setup, seed) |
| Arjun | tscircuit wrappers (compile, autoroute, DRC, metrics), model router (OpenRouter), coder, MCP access, meta-agent, ablation | `apps/worker/src/tools/`, `apps/worker/src/agents/{coder,meta}*`, `scripts/` (ablation) |
| Jack | Next.js UI, PCB preview, Vercel deploys, README, video and submission | `apps/web/` |
| Everyone | Shared contracts | `packages/types/` |

Per-person task list and timings: DESIGN.md §6.

**Atlas, harness config, memory, work queue:** use the APIs in [apps/worker/src/harness/README.md](apps/worker/src/harness/README.md) (`currentConfig`, `propose`, `retrieveLessons`, `addLesson`, `retrieveSubcircuits`, `enqueue`, `runQueue`, ...). Read it before touching Atlas from worker code; don't query or write the collections directly when a function exists.

**Web app (`apps/web`) reading backend data:** [docs/frontend-backend.md](docs/frontend-backend.md): read-only connection, what each collection holds, the query for each view, and known gaps.

**Demo:** [docs/demo.md](docs/demo.md): pre-flight checks, terminals, the command for each demo segment, cleanup, and what to do if something breaks live.

## Rules

- **Contracts are frozen.** `HarnessConfig` and `RunResult` in `packages/types` change only with team agreement.
- **Hidden checks stay hidden.** Nothing in `checks/` may reach Ripple's runtime agents: no imports into prompts, retrieval, Atlas, or MCP. That includes `checks/requirements.md` (what each spec is graded on) and `checks/reference/` (solution boards). Only Marcos edits `checks/`.
- **Parts come from the whitelist.** The coder may only use parts in `parts/whitelist.json` (agent-visible). Add a part only if `npm run verify:parts` passes.
- **One writer.** Only the worker writes to Atlas. The web app and MCP server use `MONGODB_URI_READER`.
- **No secrets in git.** Keys live in `.env` (gitignored). Never commit `.env`, `.mcp.json`, or API keys; share keys privately.
- **Watch OpenRouter spend.** Each person uses their own OpenRouter key, and each key has a small budget (around $10). Use the cheap model (e.g. `google/gemini-3.8-flash`) for development, tests and the coder; strong models only for the planner, meta-agent and demo runs. Always set `max_tokens`. Log cost per call.
- **Pin tscircuit.** `tscircuit@0.0.2646` (exact). Don't upgrade it.
- **Ignore install warnings.** `npm install` prints peer-dependency warnings and audit findings from inside tscircuit's own packages. They're expected. Never run `npm audit fix` or `--force`; it breaks the pinned versions.

## Branches

- Work on your own branch, `dev-<name>` (e.g. `dev-marcos`). Don't commit straight to `main`.
- Merge into `main` through a PR when a piece works; keep `main` runnable.
- Pull `main` into your branch often. Don't force-push shared branches.

## Setup

Node 22.13+. `cp .env.example .env`, fill in keys, `npm install`, `npm run typecheck`.

Check tscircuit works: `npm run smoke` renders `examples/led-board.tsx` through the autorouter and DRC, prints trace/via/error counts, and writes `out/led-board.circuit.json` and `out/led-board.pcb.svg`. Expect 0 errors. The `tsci` CLI needs Bun; the smoke script uses the Node API instead.

| Command | Does |
|---|---|
| `npm run smoke` | LED test board through autorouter + DRC |
| `npm run smoke t03` | Reference USB-C → 3.3V board (hidden) through autorouter + DRC |
| `npm run verify:parts` | Renders every whitelisted part and checks its stored footprint (courtyard, pads); `-- --write` re-measures them into `parts/whitelist.json` |
| `npm run test:checks` | Hidden checker tests (good boards pass, broken boards fail) |
| `npm run export <board>` | All deliverables (Gerbers, BOM, KiCad, 3D, images, report) to `out/<board>/` and zips |
| `npm run test:planner` / `test:assembler` / `test:export` / `test:placement` | Planner, assembler, deliverables, part placement tests |
| `npm run try:critic` / `try:planner` | One real model call each (cheap model, ~1 cent) |
| `npm run lessons` | List lessons; `-- retire <id> "<why>"` stops using one (kept in Atlas), `-- restore <id>` brings it back |
| `npm run finale -- --stub [--reset]` | Finale through the durable queue with stand-in planner + coder (no model calls). Ctrl+C mid-run, rerun: it resumes. Writes deliverables to `out/<board>/` and zips |
| `npm run finale -- --stub --clean` | Delete the finale board from Atlas without running (do this before recording) |
| `npm run finale` | Same with the real planner, coder and critic. A failed assembly is blamed per subcircuit and repaired (`--repairs <n>`, default 2) |
| `STUB_BREAK=sensors npm run finale -- --stub --reset` | Tests the repair loop with no model calls: the stand-in unwires that block, the loop repairs it |
| `npm run green` | Checks Atlas writer, read-only reader, Voyage, OpenRouter + LangSmith |
| `npm run setup:indexes` / `npm run seed:config` | Atlas collections and indexes / harness config v0 (both done; safe to re-run) |
| `npm run queue:demo` | Work-queue kill-and-resume demo (Ctrl+C mid-run, rerun, it resumes) |
| `npm run worker` | Serves spec requests from the web app (`spec_requests` change stream); restart resumes interrupted requests |
| `npm run evolve` | Recursive-harnessing loop: batch → meta-agent proposal → config gate verdict (`-- --rounds N`, `-- --specs a,b`; spends model budget) |
| `npm run board -- <spec_id> [--no-memory]` | One spec through the single-board loop, narrated: failures per attempt, critic diagnosis, lessons (demo segment 1) |

## Specs and parts

- `specs/specs.json`: 8 training (`t*`) and 4 held-out (`h*`) specs. Held-out specs are for the ablation only.
- `parts/whitelist.json`: 16 parts with footprints, pin labels, power/ground pin attributes, and datasheet notes. Spread `props` into the element: `<chip name="U1" {...part.props} />`.
