# specs

Public spec text only: `specs.json`, 8 training (`t*`) and 4 held-out (`h*`) specs, matching the `Spec` type in `packages/types`.
Held-out specs are for the ablation only; never use them to tune the harness.
What each spec is graded on lives in `checks/requirements.md`, which runtime agents never see.

Each spec names its header pin labels, e.g. `(3V3, GND, SDA, SCL)`. Boards must use exactly those labels; hidden checks find nets through them.

`finale.json` is the long-horizon finale board (not part of train or held-out). Its reference board in `checks/reference/finale.tsx` is split into three groups (power, mcu, sensors), one per work-queue item.
