// One real critic call on the fixture failure. Costs money; not part of the tests.
// Usage: npx tsx --env-file=.env apps/worker/src/agents/critic.verify.ts [cheap|strong]
// Uses OpenRouter directly until tools/router.ts (Arjun) lands; then swap in callModel from there.
import { runCritic, type CallModel } from "./critic.js";
import { spec, failingCode, failedResult, config } from "./critic.fixture.js";

const MODEL_IDS = { cheap: "openai/gpt-4o-mini", strong: "anthropic/claude-sonnet-4.5" } as const;

const callModel: CallModel = async ({ role, messages, config }) => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const tier = config.routing[role];
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Ripple critic verify" },
    body: JSON.stringify({ model: MODEL_IDS[tier], messages, usage: { include: true } }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { model?: string; choices: { message: { content: string } }[]; usage?: { total_tokens?: number; cost?: number } };
  return { content: data.choices[0].message.content, model: data.model ?? MODEL_IDS[tier], tier, totalTokens: data.usage?.total_tokens, costUsd: data.usage?.cost };
};

const tier = (process.argv[2] as "cheap" | "strong") || "cheap";
const result = await runCritic({
  spec, code: failingCode, result: failedResult,
  config: { ...config, routing: { ...config.routing, critic: tier } },
  lessons: [{ pattern: "Chip supply pin without decoupling", fix: "100nF from the supply pin to ground, close to the pin" }],
  callModel,
});
console.log(JSON.stringify({ ...result, fix: { ...result.fix, code: result.fix.code.slice(0, 2000) } }, null, 2));
