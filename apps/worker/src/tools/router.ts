// Model router: resolves an agent role to a model tier via HarnessConfig,
// maps the tier to a concrete OpenRouter model id (single place to swap
// model ids), and makes the call. Agents never talk to OpenRouter directly.
import type { AgentName, HarnessConfig, ModelTier } from "@board-forge/types";

// Swap model ids here only. Confirmed cheap/strong pair for Ripple — see
// report to Arjun for rationale.
const MODEL_IDS: Record<ModelTier, string> = {
  cheap: "openai/gpt-4o-mini",
  strong: "anthropic/claude-sonnet-4.5",
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallModelInput {
  role: AgentName;
  messages: ChatMessage[];
  config: HarnessConfig;
}

export interface RouterCallResult {
  content: string;
  model: string;
  tier: ModelTier;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export async function callModel({ role, messages, config }: CallModelInput): Promise<RouterCallResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const tier = config.routing[role];
  const model = MODEL_IDS[tier];

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/ripple",
      "X-Title": "Ripple",
      "Content-Type": "application/json",
    },
    // usage.include asks OpenRouter to return real cost in the response
    // instead of us maintaining a per-model price table.
    body: JSON.stringify({ model, messages, usage: { include: true } }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    model?: string;
    choices: { message: { content: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
  };

  return {
    content: data.choices[0].message.content,
    model: data.model ?? model,
    tier,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
    totalTokens: data.usage?.total_tokens,
    costUsd: data.usage?.cost,
  };
}
