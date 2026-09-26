# web

Ripple's front end. Owner: Jack.

Next.js 16 (App Router) + React 19 + Tailwind 4 + React Three Fiber.
Reads only — the worker is the single writer to Atlas (see repo `AGENTS.md`).

## Run

```
npm install                     # from the repo root (npm workspaces)
npm run dev -w @ripple/web      # http://localhost:3000
```

`http://localhost:3000/?autoplay=1` starts the build on load — use it when
recording the demo video so there's no click on camera.

## What it does

A dark engineering dashboard built around a live 3D PCB. Pressing **Build**
replays a scripted agent run: the board is planned, parts are placed, traces
route in, a hidden check fails, the critic explains it, a repair part drops in,
and the checks pass. Roughly 13 seconds.

## Architecture

The 3D world and the instrumentation are pure presentation — they take props
and know nothing about where snapshots come from.

```
lib/demoSnapshots.ts     <- the ONLY file that knows the demo is scripted
        |
        v
components/RippleDashboard.tsx    (owns state + the build runner)
        |
        +-- components/pcb/        the world: scene, board, parts, traces,
        |                          skybox, grid, ripple propagation, HUD
        +-- components/activity/   ExecutionTrace
        +-- components/build/      StageRibbon, HistoryGraph, Telemetry,
                                   SpecificationBar
```

To connect the real backend, replace `demoSnapshots.ts` with a feed producing
the same `BuildSnapshot[]`. Nothing downstream changes.

| File | Role |
|---|---|
| `lib/types.ts` | `PCBState`, `BuildSnapshot`, `DesignMetrics`, stage list |
| `lib/demoSnapshots.ts` | The scripted 12-snapshot run |
| `lib/pcbDiff.ts` | `diffPCBStates` — decides what animates and what ripples |
| `lib/metrics.ts` | Derives the telemetry line from board state |

`PCBState` is deliberately **not** Circuit JSON. When tscircuit output is
available, write a `CircuitJSON -> PCBState` adapter and leave the scene alone.

## Design language

- The board is the product; everything else is instrumentation floating over
  it. Panels sit within a few percent of the world's darkness, separated by
  spacing and type weight rather than borders.
- Sans for the interface. Mono only for machine values — designators,
  measurements, step numbers.
- Colour encodes state and nothing else: accent = active, green = passed,
  red = failed, amber = repairing. Normal events are neutral.
- **Change propagation** is the signature: any meaningful edit emits one
  expanding ring from the part that changed (`RippleField`).

## Notes for whoever touches the 3D scene

- Board coords are `(x, y)` from the board centre; the scene maps `y` onto `-Z`.
- Components animate on **mount** (stable ids keep existing meshes alive), while
  *changed* parts are re-highlighted from the diff via `flashToken`.
- Traces reveal progressively in `useFrame`, with a timer fallback so a stalled
  frame loop can never strand a trace at zero length.
- WebGL failures are caught by a boundary in `PCBViewport`; the rest of the
  dashboard keeps working.

## Deliverables

`GET /api/boards/:id/deliverables` returns the manifest; `?file=<path>` returns
one file with its MIME type. Zips are served from `/deliverables/<id>-*.zip`.
The route is **Node runtime, never Edge** — the exporter depends on the native
`@resvg/resvg-js`.

Today it serves a bundle pre-generated with `npm run export t04`, committed
under `public/deliverables/`. `buildDeliverables` takes a couple of seconds,
which is fine for a CLI and far too slow to sit in front of a live demo. When
boards land in Atlas, swap the resolver for:

```ts
const board = await boards.findOne({ _id: id })
const d = await buildDeliverables({ circuitJson: board.circuit_json, name: id })
```

and leave the responses identical.

Only paths listed in the manifest are served, and board ids are pattern-checked,
so neither can be used to walk out of the bundle directory.

**Never feed deliverables back to the agents** — `report.md` embeds hidden-check
failure detail.

## Atlas

Read-only, per `docs/frontend-backend.md`. `lib/db.ts` holds a cached
`MongoClient` on `MONGODB_URI_READER`; the worker is the only writer. Query
from route handlers only, never the browser, and never import
`apps/worker/src/db.ts` — it demands the writer URI and throws without it.

| Route | Returns |
|---|---|
| `GET /api/health` | connection state, per-collection counts, latency |
| `GET /api/runs?since=&board_id=&limit=` | run feed; `since` is an ISO string for polling |
| `GET /api/harness` | every config version plus the current kept one |
| `GET /api/memory` | active lessons and reusable subcircuits |
| `GET /api/queue?board_id=` | work items, with `stale` computed for dead workers |

`/live` renders all of it, polling every 2s — serverless functions can't hold a
change stream open. Embeddings are projected out of every response.

**Environment:** `MONGODB_URI_READER` and `MONGODB_DB` locally in
`apps/web/.env.local` (gitignored), and in the Vercel project's environment
variables for deploys. Without them `/live` reports "Disconnected" and the
routes return 503 rather than crashing the page.

`/` does not touch Atlas: it stays on scripted snapshots so the demo cannot be
broken by the database.
