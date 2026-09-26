# ripple

A self-improving harness that designs circuit boards from an English spec, checks them against hidden specs it never sees, and rewrites its own config based on what fails. Built at the MongoDB Harness Engineering & Model Wrangling Hackathon (Sept 26, 2026). See [DESIGN.md](DESIGN.md).

## Setup

Requires Node 22.13+ (the MongoDB MCP server won't start on older) and [Bun](https://bun.sh) (tscircuit's CLI runs on it; Bun is also the package manager here).

```bash
bun install
cp .env.example .env        # fill in Atlas URIs and API keys
bun run setup:indexes       # collections, indexes, 3 vector indexes (M0 limit)
bun run green               # atlas, reader, tscircuit, voyage, models; all must pass
```

`bun run green atlas voyage` runs only the named checks.

## Layout

```
apps/worker/     harness: agents, tools, config gate, queue (src/db.ts is the Atlas client)
packages/types/  frozen contracts: HarnessConfig, RunResult
scripts/         index setup, green check
```

Pinned versions (no upgrades during the event): tscircuit 0.0.2646, ai 7.0.116, @openrouter/ai-sdk-provider 3.1.0, mongodb 7.6.0, langsmith 0.10.5. tscircuit needs TypeScript 5.x and zod 3.x, which is why those are not on the latest majors.
