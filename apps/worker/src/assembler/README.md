# assembler

Deterministic: combines finished subcircuits into one board. Owner: Marcos.

```ts
import { assemble } from "./assembler.js"

const { code, circuitJson, board, layout, result } = await assemble(
  [{ name: "power", code: powerTsx }, { name: "mcu", code: mcuTsx }],
  { specId: "finale" },
)
```

`assemble(subcircuits, options)` measures each subcircuit alone, shelf-packs the bounding boxes so
no two groups overlap, sizes the board to fit, writes one single-file tscircuit source, evaluates it
with `@tscircuit/eval`, and returns `{ code, circuitJson, board, layout }`. With `specId` it also runs
the hidden checker and returns `result: RunResult`.

## Subcircuit contract

Each subcircuit is a tscircuit TSX **code string** that:

1. has exactly one named export, a component with no required props that returns a `<group name="...">`
   (`export const Power = () => <group name="power">...</group>`);
2. connects to the rest of the board **only through named nets**: `net.V3V3`, `net.GND`, `net.SDA`,
   `net.SCL`, `net.VBUS`... Never reference another group's components (`.U1 > .VCC` from a
   different group does not resolve);
3. uses unique component names across the whole board (`U1`, `U2`... not `U1` in every group);
4. is self-contained: no `import` statements, no `<board>`; part props (footprint, pinLabels...) are
   written inline;
5. places its parts with `pcbX`/`pcbY` relative to the group. The group's own `pcbX`/`pcbY`, if any,
   is kept and the assembler moves the whole group with a wrapper.

Net names are the interface between work-queue items, so the planner must hand every coder the same
rail and bus names.

## Options

| Option | Default | Meaning |
|---|---|---|
| `specId` | none | grade with `runChecks(circuitJson, loadExpected(specId))` |
| `gapMm` | 3 | clearance between group bounding boxes |
| `marginMm` | 3 | clearance to the board edge |
| `rowWidthMm` | from total area | target row width for the shelf packing |

## Layout

Groups are sorted tallest first (ties by name) and placed left to right in rows of at most
`rowWidthMm`, then the whole layout is centred on the board origin. Bounding boxes come from the
placed parts and pads, so they don't overlap by construction. The autorouter routes across groups.

## Tests

`npm run test:assembler` splits the finale reference (`checks/reference/finale.tsx`) into its three
groups, assembles them, and asserts 0 DRC errors and that `loadExpected("finale")` passes. A second
case leaves out the sensors group and asserts the checks fail with clear details.
