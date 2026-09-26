// Runs the critic once on a deliberately broken board, with a real model, and prints its output.
// Does not store lessons. Usage: npm run try:critic   (needs OPENROUTER_API_KEY; one strong-model call)
import { RootCircuit } from "tscircuit"
import whitelist from "../parts/whitelist.json" with { type: "json" }
import specs from "../specs/specs.json" with { type: "json" }
import { runChecks, loadExpected } from "../checks/index.ts"
import { runCritic, CRITIC_SCHEMA } from "../apps/worker/src/agents/critic/index.ts"

const part = (id: string) => whitelist.parts.find((p) => p.id === id)!.props as any
const code = `<board width="24mm" height="18mm">
  <chip name="U1" {...part("temp_sensor_lm75")} pcbX={0} pcbY={0} />
  <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={10} pcbY={2} pcbRotation={90} />
  <pinheader name="J1" pinCount={4} pinLabels={["3V3", "GND", "SDA", "SCL"]} footprint="pinrow4" pcbX={0} pcbY={-6} />
  <trace from=".J1 > .pin1" to="net.V" />
  <trace from=".J1 > .pin2" to="net.G" />
  <trace from=".J1 > .pin3" to=".U1 > .SDA" />
  <trace from=".J1 > .pin4" to=".U1 > .SCL" />
  <trace from=".U1 > .VCC" to="net.V" />
  <trace from=".U1 > .GND" to="net.G" />
  <trace from=".C1 > .pin1" to=".U1 > .VCC" />
  <trace from=".C1 > .pin2" to="net.G" />
  <trace from=".U1 > .A1" to="net.G" />
  <trace from=".U1 > .A2" to="net.G" />
</board>`
const Board = () => (
  <board width="24mm" height="18mm">
    <chip name="U1" {...part("temp_sensor_lm75")} pcbX={0} pcbY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={10} pcbY={2} pcbRotation={90} />
    <pinheader name="J1" pinCount={4} pinLabels={["3V3", "GND", "SDA", "SCL"]} footprint="pinrow4" pcbX={0} pcbY={-6} />
    <trace from=".J1 > .pin1" to="net.V" />
    <trace from=".J1 > .pin2" to="net.G" />
    <trace from=".J1 > .pin3" to=".U1 > .SDA" />
    <trace from=".J1 > .pin4" to=".U1 > .SCL" />
    <trace from=".U1 > .VCC" to="net.V" />
    <trace from=".U1 > .GND" to="net.G" />
    <trace from=".C1 > .pin1" to=".U1 > .VCC" />
    <trace from=".C1 > .pin2" to="net.G" />
    <trace from=".U1 > .A1" to="net.G" />
    <trace from=".U1 > .A2" to="net.G" />
  </board>
)

const spec = specs.find((s) => s._id === "t04_i2c_temp_breakout")! as { _id: string; text: string; split: "train" }
const circuit = new RootCircuit()
circuit.add(<Board />)
await circuit.renderUntilSettled()
const result = await runChecks(circuit.getCircuitJson(), loadExpected(spec._id), { board_id: "try", harness_version: 0 })
console.log("FAILURES:\n" + result.failures.map((f) => `  ${f.check}: ${f.detail}`).join("\n"))

const model = process.env.CRITIC_MODEL || "anthropic/claude-sonnet-5"
const out = await runCritic(
  { spec, code, result, lessons: [], rules: [], attempt: 1, repairBudget: 3 },
  {
    async complete(system, user, schema: typeof CRITIC_SCHEMA) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_schema", json_schema: schema }, max_tokens: Number(process.env.CRITIC_MAX_TOKENS ?? 2000), usage: { include: true } }),
      })
      const json: any = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 300))
      console.log(`model ${model}, cost $${Number(json.usage?.cost ?? 0).toFixed(4)}`)
      return JSON.parse(json.choices[0].message.content)
    },
    async addLesson() { return "(not stored)" },
  },
)
console.log(JSON.stringify(out, null, 2))
