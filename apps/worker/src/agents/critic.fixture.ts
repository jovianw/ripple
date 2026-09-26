// A real failed run: the t04 breakout with no pull-ups, no decoupling cap, and floating address pins.
// The RunResult is verbatim checker output (checks/ is not imported here).
import type { HarnessConfig, RunResult } from "@ripple/types";

export const spec = {
  _id: "t04_i2c_temp_breakout",
  text: "A breakout for an I2C temperature sensor. Power it at 3.3V from a 4-pin header (3V3, GND, SDA, SCL).",
};

export const failingCode = `export default () => (
  <board width="30mm" height="20mm">
    <pinheader name="J1" pinCount={4} pinLabels={["3V3", "GND", "SDA", "SCL"]} footprint="pinrow4" pcbX={-11} pcbRotation={90} />
    <chip name="U1" manufacturerPartNumber="LM75B" footprint="soic8" pinLabels={{ pin1: "SDA", pin2: "SCL", pin3: "OS", pin4: "GND", pin5: "A2", pin6: "A1", pin7: "A0", pin8: "VCC" }} pcbX={2} pcbY={0} />
    <trace from=".J1 > .pin1" to="net.V3V3" />
    <trace from=".J1 > .pin2" to="net.GND" />
    <trace from=".J1 > .pin3" to="net.SDA" />
    <trace from=".J1 > .pin4" to="net.SCL" />
    <trace from=".U1 > .VCC" to="net.V3V3" />
    <trace from=".U1 > .GND" to="net.GND" />
    <trace from=".U1 > .SDA" to="net.SDA" />
    <trace from=".U1 > .SCL" to="net.SCL" />
  </board>
)`;

export const failedResult: RunResult = {
  board_id: "b_t04_attempt1",
  harness_version: 1,
  stage: "checks",
  ts: "2026-09-26T16:11:35.132Z",
  passed: false,
  failures: [
    { check: "pullups", detail: "SDA (header:SDA) has no pull-up resistor to header:3V3" },
    { check: "pullups", detail: "SCL (header:SCL) has no pull-up resistor to header:3V3" },
    { check: "decoupling", detail: "U1 VCC has no capacitor to header:GND on its net" },
    { check: "tied", detail: "role:temp_sensor A0: U1.A0 is floating (tie it to header:3V3 or header:GND)" },
    { check: "tied", detail: "role:temp_sensor A1: U1.A1 is floating (tie it to header:3V3 or header:GND)" },
    { check: "tied", detail: "role:temp_sensor A2: U1.A2 is floating (tie it to header:3V3 or header:GND)" },
  ],
  drc_errors: 0,
};

export const config: HarnessConfig = {
  version: 1,
  parent: null,
  rules: ["Use only whitelisted parts and standard 0603 passives."],
  context: { subcircuits_k: 2, lessons_k: 5, rerank: true, include_last_failure: true },
  tools: { route_requires_connectivity: true, parts_whitelist: "v2", mcp: { planner: [], coder: [], critic: ["find"], meta: ["find"] } },
  workflow: { plan_first: true, repair_budget: 3, split_over_parts: 12 },
  routing: { planner: "strong", coder: "cheap", critic: "strong", meta: "strong" },
  verdict: "kept",
  rationale: "baseline",
};
