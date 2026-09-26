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
