# checks

Hidden checker and check definitions. Owner: Marcos.

Agents never read this folder, and check contents never go into Atlas.
Keep it out of agent context, retrieval, and MCP access.

## API

```ts
import { runChecks, loadExpected } from "../../checks/index.ts"

const result = await runChecks(circuitJson, loadExpected("led-board"), { board_id, harness_version })
// result: RunResult from packages/types, stage "checks"
```

`runChecks(circuitJson, expected, meta?)` never throws on a bad board; problems come back as
`failures: [{ check, detail }]`. `passed` is true only when `failures` is empty.
`drc_errors` counts render/autoroute errors in the Circuit JSON plus `@tscircuit/checks` errors
(warnings are ignored).

| `check` | Fails when |
|---|---|
| `connectivity` | a required net's pins are not all on one electrical net, or a named net is missing |
| `separate` | two nets that must stay apart are the same net (a short) |
| `pullups` | an I2C line has no resistor to VCC, or its value is outside the window |
| `decoupling` | no capacitor from the chip's power pin to ground within `max_mm` (default 3) |
| `drc` | more than `max_errors` (default 0) routing or design-rule errors |
| `input` | the Circuit JSON is not an array |

## Expected checks per spec

Types: [expected.ts](expected.ts). One file per spec in [specs/](specs/), registered in
[specs/index.ts](specs/index.ts) under the spec id.

References: `"VCC"` is a named net; `"U1.VCC"` is the net on pin VCC of component U1.
Pins match by name, label, `pinN`, or number.

```ts
export const expected: ExpectedChecks = {
  nets: [{ name: "VCC", pins: ["U1.VCC", "U2.VDD", "C1.pin1"] }, { name: "SDA" }],
  separate: [["VCC", "GND"]],
  i2c: [{ sda: "SDA", scl: "SCL", vcc: "VCC", min_ohms: 1000, max_ohms: 10000 }],
  decoupling: [{ chip: "U1", power_pin: "VCC", ground: "GND", max_mm: 3, min_farads: 1e-7 }],
  drc: { max_errors: 0 },
}
```

## Tests

`npm run test:checks` renders the LED board and an I2C fixture, then deliberately broken variants
(dropped trace, unrouted trace, missing pull-up, wrong pull-up value, cap too far, cap missing,
VCC shorted to GND) and asserts each fails on the right check with a clear detail.
Typecheck this folder with `npx tsc -p checks`.
