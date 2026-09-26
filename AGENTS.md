# AGENTS.md

Guide for coding agents working in this repo. Read before making changes.

## Project

Board Forge: a self-improving harness that designs PCBs (tscircuit) from an English spec, grades them against hidden checks, and evolves its own config. Full design: [DESIGN.md](DESIGN.md). Team brief: [docs/board_forge_pcb_brief_V2.pdf](docs/board_forge_pcb_brief_V2.pdf).

## Who owns what

Stay inside your person's area. To change another area, ask its owner.

| Owner | Area | Paths |
|---|---|---|
| Marcos | Specs, hidden checker, critic, planner, assembler, parts whitelist, finale board | `checks/`, `specs/`, `apps/worker/src/agents/{critic,planner}*`, assembler |
| Jovian | Atlas (`db.ts`), config versioning and gate, memory and retrieval (Voyage), work queue, change streams | `apps/worker/src/db.ts`, `apps/worker/src/harness/`, `scripts/` (index setup, seed) |
| Arjun | tscircuit wrappers (compile, autoroute, DRC, metrics), model router (OpenRouter), coder, MCP access, meta-agent, ablation | `apps/worker/src/tools/`, `apps/worker/src/agents/{coder,meta}*`, `scripts/` (ablation) |
| Jack | Next.js UI, PCB preview, Vercel deploys, README, video and submission | `apps/web/` |
| Everyone | Shared contracts | `packages/types/` |

Per-person task list and timings: DESIGN.md §6.

## Rules

- **Contracts are frozen.** `HarnessConfig` and `RunResult` in `packages/types` change only with team agreement.
- **Hidden checks stay hidden.** Nothing in `checks/` may reach Board Forge's runtime agents: no imports into prompts, retrieval, Atlas, or MCP. Only Marcos edits `checks/`.
- **One writer.** Only the worker writes to Atlas. The web app and MCP server use `MONGODB_URI_READER`.
- **No secrets in git.** Keys live in `.env` (gitignored). Never commit `.env`, `.mcp.json`, or API keys; share keys privately.
- **Watch OpenRouter spend.** Shared budget is $100 for the day. Log cost per call; use cheap models while developing.
- **Pin tscircuit.** Don't upgrade it.
- **Small commits, pull often.** Four people push to `main`: `git pull --rebase` before pushing; don't force-push.

## Setup

Node 22.13+. `cp .env.example .env`, fill in keys, `npm install`, `npm run typecheck`.
