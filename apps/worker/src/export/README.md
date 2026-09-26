# export

Board deliverables from Circuit JSON. Owner: Marcos. Pure functions: no DB, no model calls.

```ts
import { buildDeliverables, zipDeliverables, zipFabrication } from "./deliverables.js"

const d = await buildDeliverables({ circuitJson, name: "finale", specId, specText, source, result, harnessVersion })
d.files      // path -> string | Uint8Array
d.manifest   // { name, spec_id, generated_at, metrics, files: [{ path, category, description, mime, bytes }] }
d.skipped    // exporters that failed, with the reason (the rest are still valid)
zipDeliverables(d, "finale")   // everything, under finale/
zipFabrication(d)              // Gerbers + drill only, flat: what a board house wants
```

CLI: `npm run export finale` (any reference board or spec id), or `npm run export -- --json board.circuit.json name`.
Writes `out/<name>/`, `out/<name>-deliverables.zip` and `out/<name>-gerbers.zip`. About 6 s for the finale.

## Files

| Path | Category | What it is | Who uses it |
|---|---|---|---|
| `fabrication/*.gbr`, `*.drl` | fabrication | Gerber layers (copper, mask, paste, silkscreen, outline) + Excellon drill | Board house (JLCPCB, PCBWay) |
| `assembly/bom.csv` | assembly | Bill of materials, with manufacturer part numbers for chips | Sourcing, assembly |
| `assembly/pnp.csv` | assembly | Pick-and-place: part positions and rotations | Machine assembly |
| `assembly/assembly.svg` | assembly | Assembly drawing | Hand assembly |
| `kicad/<name>.kicad_pro/.kicad_sch/.kicad_pcb` | cad | Full KiCad project | Engineers who want to edit |
| `3d/<name>.glb` | 3d | 3D model of the board | 3D viewer |
| `images/pcb.{svg,png}`, `images/schematic.{svg,png}` | image | PCB and schematic views | Previews, report, video |
| `netlist.csv` | data | Every net and the pins on it | Review |
| `simulation/<name>.cir` | simulation | SPICE netlist of the passive network (no sources) | Simulation |
| `design/circuit.json`, `design/<name>.tsx` | data | Full design; tscircuit source if given | Re-rendering, the "why?" view |
| `report.md`, `report.json` | report | Spec, hidden-check result, metrics, grouped BOM, file index, limits | Judges, users |
| `manifest.json` | report | File list with categories, MIME types and sizes | The front end |

## Front end

The `boards` collection already stores `circuit_json`, so deliverables can be built on demand; nothing extra is stored.
Suggested Next.js route (Node runtime, not Edge: `@resvg/resvg-js` is native):

- `GET /api/boards/:id/deliverables` → `manifest.json` (list files, show metrics)
- `GET /api/boards/:id/deliverables?file=<path>` → one file with its `mime`
- `GET /api/boards/:id/deliverables.zip` → `zipDeliverables`; `?only=gerbers` → `zipFabrication`

The report includes hidden-check failure details; that's fine for people, but never feed deliverables back to the agents.
