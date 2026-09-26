// Runs the finale (or any spec) as a long-horizon board through the durable queue:
// plan -> coder per subcircuit -> route + DRC + interface check -> assemble -> hidden checks -> deliverables.
//
//   npm run finale -- --stub            dry run: stand-in planner + coder built from the finale reference (no model calls)
//   npm run finale                      real run: real planner call + Arjun's runCoder (cheap model)
//   npm run finale -- --reset [--stub]  delete this board's queue items, runs and boards first
//   options: --board <id> (default finale-dry / finale-live), --spec <id> (default finale)
// Kill it mid-run (Ctrl+C) and run the same command again: it resumes from the queue.
import { readFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"
import finaleSpec from "../specs/finale.json" with { type: "json" }
import specs from "../specs/specs.json" with { type: "json" }
import whitelist from "../parts/whitelist.json" with { type: "json" }
import { client, col, connect } from "../apps/worker/src/db.ts"
import { currentConfig } from "../apps/worker/src/harness/config.ts"
import { runPlannedBoard, type PlannedBoardDeps } from "../apps/worker/src/pipeline/planned-board.ts"
import { evaluateCircuitSource } from "../apps/worker/src/tools/evaluate.ts"
import { runCoder } from "../apps/worker/src/agents/coder.ts"
import { buildDeliverables } from "../apps/worker/src/export/deliverables.ts"
import type { PlannerOutput } from "../apps/worker/src/agents/planner/index.ts"

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
const stub = process.argv.includes("--stub")
const specId = arg("--spec") ?? "finale"
const spec = [...specs, finaleSpec].find((s) => s._id === specId)
if (!spec) throw new Error(`unknown spec ${specId}`)
const boardId = arg("--board") ?? `${specId}-${stub ? "dry" : "live"}`
const STEP_MS = Number(process.env.STUB_STEP_MS ?? 2000)
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`)

await connect()
if (process.argv.includes("--reset")) {
  const [q, r, b] = await Promise.all([col.queue.deleteMany({ board_id: boardId }), col.runs.deleteMany({ board_id: boardId }), col.boards.deleteMany({ board_id: boardId })])
  log(`reset ${boardId}: removed ${q.deletedCount} queue items, ${r.deletedCount} runs, ${b.deletedCount} boards`)
}

// ---- stand-ins for the dry run: the finale reference split into its three groups ----
const finaleSource = readFileSync("checks/reference/finale.tsx", "utf8")
const inlineParts = (code: string) => code.replace(/\{\.\.\.part\("([^"]+)"\)\}/g, (_, id) =>
  `{...(${JSON.stringify(whitelist.parts.find((p) => p.id === id)!.props)})}`)
const referenceGroup = (exportName: string) => {
  const m = finaleSource.match(new RegExp(`export const ${exportName} = \\(\\) => \\(\\n([\\s\\S]*?)\\n\\)\\n`))
  if (!m) throw new Error(`${exportName} not in finale.tsx`)
  // Just the group's children: the real coder writes parts directly inside <board>, and so does the stand-in.
  return inlineParts(m[1]).replace(/^\s*<group\b[^>]*>\n?/, "").replace(/\n?\s*<\/group>\s*$/, "")
}
const REF: Record<string, string> = { power: "FinalePower", mcu: "FinaleMcu", sensors: "FinaleSensors" }
const stubPlan: PlannerOutput = {
  summary: "stand-in plan: the finale reference's three groups",
  nets: [
    { name: "V3V3", kind: "power", description: "3.3V rail" },
    { name: "GND", kind: "ground", description: "ground" },
    { name: "SDA", kind: "bus", description: "I2C data" },
    { name: "SCL", kind: "bus", description: "I2C clock" },
  ],
  subcircuits: [
    { key: "power", title: "USB-C to 3.3V", purpose: "USB-C sink, 3.3V LDO, power LED", depends_on: [], headers: [], reuse_subcircuit_id: "", nets: ["V3V3", "GND"],
      parts: [{ part: "usb_c_receptacle", qty: 1, for: "input" }, { part: "resistor_0603", qty: 3, for: "CC pull-downs, LED" }, { part: "ldo_3v3_ap2112k", qty: 1, for: "regulator" }, { part: "capacitor_0603", qty: 2, for: "LDO caps" }, { part: "led_0603", qty: 1, for: "power LED" }] },
    { key: "mcu", title: "ATtiny85 + ISP", purpose: "MCU, reset pull-up, status LED, ISP header", depends_on: ["power"], headers: [0], reuse_subcircuit_id: "", nets: ["V3V3", "GND", "SDA", "SCL"],
      parts: [{ part: "mcu_attiny85", qty: 1, for: "mcu" }, { part: "capacitor_0603", qty: 1, for: "decoupling" }, { part: "resistor_0603", qty: 2, for: "reset, LED" }, { part: "led_0603", qty: 1, for: "status LED" }, { part: "header_6", qty: 1, for: "ISP" }] },
    { key: "sensors", title: "LM75 + SHT40", purpose: "two I2C sensors with pull-ups", depends_on: ["power"], headers: [], reuse_subcircuit_id: "", nets: ["V3V3", "GND", "SDA", "SCL"],
      parts: [{ part: "temp_sensor_lm75", qty: 1, for: "temperature" }, { part: "humidity_sensor_sht40", qty: 1, for: "humidity" }, { part: "capacitor_0603", qty: 2, for: "decoupling" }, { part: "resistor_0603", qty: 2, for: "I2C pull-ups" }] },
  ],
}

async function liveComplete(system: string, user: string, schema: unknown) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.PLANNER_MODEL || "google/gemini-3.8-flash", max_tokens: 4000, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_schema", json_schema: schema } }),
  })
  const json: any = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 300))
  return JSON.parse(json.choices[0].message.content)
}

const deps: PlannedBoardDeps = stub
  ? {
      planner: { complete: async () => structuredClone(stubPlan) },
      async coder(input) {
        await sleep(STEP_MS) // time to Ctrl+C mid-run
        const key = Object.keys(REF).find((k) => input.specText.includes(`prefix ${k.slice(0, 4).toUpperCase()}_`)) ?? "power"
        const source = `export default () => (\n  <board>\n${referenceGroup(REF[key])}\n  </board>\n)\n`
        return { source, circuitJson: (await evaluateCircuitSource(source)).circuitJson as never }
      },
      log,
    }
  : { planner: { complete: liveComplete }, coder: (input) => runCoder(input) as never, log }

const config = await currentConfig()
log(`${boardId}: spec ${specId}, harness v${config.version}, ${stub ? "stand-in planner + coder" : "live planner + coder"}`)
const { progress, final } = await runPlannedBoard(boardId, spec, config, deps)
log(`queue: ${progress.done}/${progress.total} done, ${progress.failed} failed, ${progress.pending} pending`)
for (const i of progress.items) if (i.status !== "done") log(`  ${i.key} ${i.status}: ${i.error ?? ""}`)
if (final) {
  log(`final board: ${final.passed ? "PASSED hidden checks" : `failed: ${(final.failures as { detail: string }[]).map((f) => f.detail).join("; ")}`}`)
  const d = await buildDeliverables({ circuitJson: final.circuit_json, name: boardId, specId, specText: spec.text, source: final.code, harnessVersion: config.version })
  log(`deliverables: ${d.manifest.files.length} files (${d.skipped.length} skipped); run \`npm run export -- --json\` on the stored circuit to write them`)
}
await client.close()
process.exit(final?.passed ? 0 : 1)
