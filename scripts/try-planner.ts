// Runs the planner once on a spec with a real model and prints the plan. Nothing is enqueued.
// Usage: npm run try:planner [spec id]   (default finale; needs OPENROUTER_API_KEY; one model call, ~1 cent)
import specs from "../specs/specs.json" with { type: "json" }
import finale from "../specs/finale.json" with { type: "json" }
import { plan } from "../apps/worker/src/agents/planner/index.ts"

const id = process.argv[2] ?? "finale"
const spec = [...specs, finale].find((s) => s._id === id)
if (!spec) throw new Error(`unknown spec ${id}`)
const model = process.env.PLANNER_MODEL || "google/gemini-3.8-flash"

const result = await plan(
  { spec, rules: [], library: [] },
  { workflow: { plan_first: true, repair_budget: 3, split_over_parts: 12 } },
  {
    async complete(system, user, schema) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_schema", json_schema: schema }, usage: { include: true } }),
      })
      const json: any = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 300))
      console.log(`model ${model}, cost $${Number(json.usage?.cost ?? 0).toFixed(4)}`)
      return JSON.parse(json.choices[0].message.content)
    },
  },
)
console.log(JSON.stringify(result, null, 2))
