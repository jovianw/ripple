# Board Forge

A self-improving harness that designs circuit boards from a spec, checks them against a hidden spec it never sees, and redesigns itself based on what fails.

See [DESIGN.md](DESIGN.md).

```
apps/worker/     # harness: agents/, tools/, harness/, db.ts
apps/web/        # Next.js UI
checks/          # hidden checker (agents never read)
packages/types/  # HarnessConfig, RunResult, Board, Lesson
specs/           # public spec text only
scripts/         # index setup, seed data, ablation runner
```

Setup: Node 22.13+, `cp .env.example .env`, `npm install`.
