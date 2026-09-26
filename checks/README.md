# checks

Hidden checker and check definitions. Owner: Marcos.

Agents never read this folder, and check contents never go into Atlas.
Keep it out of agent context, retrieval, and MCP access.

## API

```ts
import { runChecks, loadExpected } from "../../checks/index.ts"

const result = await runChecks(circuitJson, loadExpected("t03_ldo_3v3"), { board_id, harness_version })
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
| `resistors` | a required resistor between two nets is missing or out of range (e.g. USB-C CC pull-downs) |
| `tied` | a pin that needs a defined level (address, enable, WP) is floating or on the wrong net |
| `leds` | an LED has no series resistor, shares one, is reversed, or the resistor is out of range |
| `divider` | a resistive divider's ratio or total resistance is out of range |
| `rc` | an RC time constant (debounce, low-pass) is out of range |
| `switch` | no pushbutton between the two nets |
| `drc` | more than `max_errors` (default 0) routing or design-rule errors |
| `input` | the Circuit JSON is not an array |

## Expected checks per spec

Types: [expected.ts](expected.ts). One file per spec in [specs/](specs/), registered in
[specs/index.ts](specs/index.ts) under the spec id.

Spec files refer to parts **by role, never by name**, because the coder chooses component names:

| Reference | Means |
|---|---|
| `header:SDA` | every pin-header pin labelled SDA (labels are fixed in the spec text) |
| `role:temp_sensor.VCC` | canonical pin VCC on every whitelisted part with role `temp_sensor` |
| `part:usb_c_receptacle.CC1` | canonical pin CC1 on every instance of that whitelisted part |
| `U1.VCC` / `"VCC"` | component name / named net (tests only) |

Parts are matched to `parts/whitelist.json` by manufacturer part number; `roles` and `canonicalPins`
come from there. Shared rule blocks (USB-C sink, LDO, I2C bus, MCU basics) are in
[specs/common.ts](specs/common.ts). What each spec is graded on, in words: [requirements.md](requirements.md).

```ts
export const expected: ExpectedChecks = {
  nets: [{ name: "VCC", pins: ["U1.VCC", "U2.VDD", "C1.pin1"] }, { name: "SDA" }],
  separate: [["VCC", "GND"]],
  i2c: [{ sda: "SDA", scl: "SCL", vcc: "VCC", min_ohms: 1000, max_ohms: 10000 }],
  decoupling: [{ chip: "role:temp_sensor", power_pin: "VCC", ground: "header:GND", min_farads: 1e-7 }],
  resistors: [{ label: "CC1 pull-down", a: "part:usb_c_receptacle.CC1", b: "header:GND", min_ohms: 4700, max_ohms: 5600 }],
  drc: { max_errors: 0 },
}
```

## Tests

`npm run test:checks` renders the LED board and an I2C fixture, then deliberately broken variants
(dropped trace, unrouted trace, missing pull-up, wrong pull-up value, cap too far, cap missing,
VCC shorted to GND) and asserts each fails on the right check with a clear detail.
`spec-rules.test.tsx` grades boards against the real spec files: correct boards with arbitrary part
names pass, and each common mistake (wrong LED resistor, reversed LED, shared CC resistor, missing
pull-ups, floating address pin, far decoupling cap, wrong divider ratio, wrong RC cutoff, shared LED
resistor) fails on the right check.
`reference.test.tsx` renders the reference board in [reference/](reference/) for every spec and asserts it
passes that spec's checks with 0 DRC errors, so every spec is known to be solvable with whitelisted parts.
Typecheck this folder with `npx tsc -p checks`.
