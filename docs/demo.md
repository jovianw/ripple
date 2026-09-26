# Demo runbook

Commands to run for the 3-minute demo (DESIGN.md §8) and the 1-minute recorded video. Everything runs from the repo root
on the demo laptop. Costs are on the runner's OpenRouter key.

## 30 minutes before

```bash
git pull && npm install
npm run typecheck        # exit 0
npm run green            # ✓ atlas, reader, voyage, models
npm run smoke            # render errors: 0, DRC errors: 0
npm run finale -- --stub --reset   # free dry run: "queue: 4/4 done", final board passed
```

`.env` needs every key in `.env.example` (writer and reader Atlas URIs, OpenRouter, Voyage, LangSmith). If `green` fails on
Atlas, check Atlas → Network Access still allows your IP (venue Wi-Fi changes it).

## Terminals to open

| Terminal | Command | Why |
|---|---|---|
| 1. Web app | `npm run dev -w @ripple/web` → http://localhost:3000/board (build a board) and http://localhost:3000/system (live Atlas data); http://localhost:3000 is the landing page | The screen the judges watch. Needs `apps/web/.env.local` with `MONGODB_URI_READER`, `MONGODB_DB` (and `MONGODB_URI_REQUESTS` for the prompt box). |
| 2. Worker | `npm run worker` | Runs specs submitted from the web prompt box. Leave it running; Ctrl+C then rerun resumes an interrupted request. |
| 3. Driver | the commands below | Each demo segment. |

The public Vercel URL works for browsing, but live updates and the prompt box are smoothest on the local app.

## The 3 minutes

| Time | Segment | Command (terminal 3) or action | What should appear |
|---|---|---|---|
| 0:00–0:40 | A spec fails a hidden check; the critic explains it and a lesson appears | Prompt box on `/live` with `t04_i2c_temp_breakout`, or `npm run board -- t04_i2c_temp_breakout --no-memory` | Attempt 1 fails `pullups` / `decoupling` / `tied`; critic diagnosis; `lesson: Any I2C bus → …`. Then rerun **without** `--no-memory` to show lessons in context. ~$0.05 per run. |
| 0:40–1:20 | The harness rewrites its own config, with guardrails | `npm run evolve -- --specs t04_i2c_temp_breakout,t08_i2c_two_devices` (live, ~1 min), or show the history already in `/live` | Meta-agent's proposal with its rationale, the config diff, and the gate's verdict. Example from a real run: "coder → strong" **rolled back** (0% pass at 37× cost). |
| 1:20–2:00 | Ablation: same model, bare vs v0 vs evolved | Precomputed: `npm run ablation` before the demo; `/live` shows the stored `ablations` rows | Checks passed, attempts and cost per board for each setup. |
| 2:00–2:40 | Long horizon: finale board from the queue, kill it, restart, it resumes, download its files | `npm run finale -- --reset`, press **Ctrl+C** once a subcircuit is `running`, then `npm run finale` again | "recovered 1 interrupted item(s)", steps finish, `assembled 3 subcircuits: passed`; deliverables (Gerbers, BOM, KiCad) in `out/finale-live/` and in the web app's deliverables panel. Stand-in fallback: add `--stub` (no model calls, ~10 s). |
| 2:40–3:00 | "The model didn't get smarter. The harness did." | Config diff and ablation on screen | |

Backup for the queue segment if the finale is slow: `npm run queue:demo -- --reset`, Ctrl+C mid-run,
`npm run queue:demo` again (7 steps, stand-in handler, free).

## Before 3:30 (feature freeze)

1. Get at least one **kept** config version with a new rule (the gate keeps it only if it beats its parent):
   ```bash
   npm run evolve -- --rounds 2          # all 8 training specs, ~$1–2
   ```
2. Run the ablation once a kept version exists: `npm run ablation` (stores rows for the web app).
3. Record a full backup run of the whole demo (screen + terminal) in case something breaks live.
4. Review lessons: `npm run lessons` (retire bad ones with `npm run lessons -- retire <id> "<why>"`).

## Cleanup and reset

| Command | Does |
|---|---|
| `npm run finale -- --clean` | Delete the live finale board (queue items, runs, boards) before recording. `--stub --clean` for the dry-run board. |
| `npm run queue:demo -- --reset` | Reset the stand-in queue demo board. |
| `npm run lessons -- retire <id> "<why>"` | Stop a bad lesson reaching the coder and critic (nothing is deleted). |

Config versions are never deleted: rejected and rolled-back versions are part of the story.

## If something breaks live

| Symptom | Do this |
|---|---|
| `green` fails on atlas / connection timeouts | Atlas → Security → Network Access → add current IP (or allow 0.0.0.0/0 for the day) |
| OpenRouter 402 / budget | Switch to a teammate's `.env` key; everything reads it at startup |
| `/live` says Disconnected | `apps/web/.env.local` (local) or Vercel env vars missing; redeploy after adding them |
| Prompt box request stuck in `queued` | Terminal 2: `npm run worker` isn't running |
| Finale live run fails or is slow | `npm run finale -- --stub --reset` (same queue, kill-and-resume and assembly; stand-in coder) |
| A run shows noisy `Error in createContainer` stack traces | tscircuit logging the coder's invalid JSX; the attempt is graded as a compile failure and repaired. Keep going. |
