// Model router: resolves an agent role to a model tier via HarnessConfig,
// maps the tier to a concrete OpenRouter model id (single place to swap
// model ids), and makes the call. Agents never talk to OpenRouter directly.
import type { AgentName, HarnessConfig, ModelTier } from "@ripple/types";
import { Client as LangSmith } from "langsmith";
import { traceable } from "langsmith/traceable";

// MODEL_CHEAP/MODEL_STRONG in .env override these; the literals here are
// only the fallback if the env vars aren't set.
const MODEL_IDS: Record<ModelTier, string> = {
  cheap: process.env.MODEL_CHEAP || "openai/gpt-4o-mini",
  strong: process.env.MODEL_STRONG || "anthropic/claude-sonnet-4.5",
};

// Every call is capped (AGENTS.md: always set max_tokens). A whole board of
// TSX fits comfortably; callers can raise it per call.
const DEFAULT_MAX_TOKENS = 4000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** OpenRouter/OpenAI-style structured-output schema, e.g. critic/prompt.ts's CRITIC_SCHEMA. */
export interface JsonSchema {
  name: string;
  strict?: boolean;
  schema: unknown;
}

export interface CallModelInput {
  role: AgentName;
  messages: ChatMessage[];
  config: HarnessConfig;
  maxTokens?: number;
  /** Requests JSON-schema structured output (OpenRouter response_format) instead of free text. */
  schema?: JsonSchema;
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

const langsmith = process.env.LANGSMITH_TRACING === "true" ? new LangSmith() : undefined;

async function openRouterCall(model: string, messages: ChatMessage[], maxTokens: number, schema?: JsonSchema) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

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
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      usage: { include: true },
      ...(schema && { response_format: { type: "json_schema", json_schema: schema } }),
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter request failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as {
    model?: string;
    choices: { message: { content: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
  };
}

export async function callModel({
  role,
  messages,
  config,
  maxTokens = DEFAULT_MAX_TOKENS,
  schema,
}: CallModelInput): Promise<RouterCallResult> {
  const tier = config.routing[role];
  const model = MODEL_IDS[tier];

  // Traced when LANGSMITH_TRACING=true (see green-check.ts for the same
  // pattern); falls back to a plain call otherwise so tracing setup never
  // blocks the router.
  const call = langsmith
    ? traceable((m: string, msgs: ChatMessage[], max: number, s?: JsonSchema) => openRouterCall(m, msgs, max, s), {
        name: `router:${role}`,
        run_type: "llm",
        client: langsmith,
        project_name: process.env.LANGSMITH_PROJECT,
      })
    : openRouterCall;

  const data = await call(model, messages, maxTokens, schema);

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

/**
 * The critic and planner both take a `complete(system, user, schema) -> Promise<unknown>`
 * dependency (see CriticDeps/PlannerDeps) so they stay model-agnostic. Role and config
 * pick the tier the same way callModel does; bind them once per caller.
 */
export function createComplete(role: AgentName, config: HarnessConfig) {
  return async function complete(system: string, user: string, schema: JsonSchema): Promise<unknown> {
    const result = await callModel({
      role,
      config,
      schema,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    try {
      return JSON.parse(result.content);
    } catch (cause) {
      throw new Error(`${role} model returned non-JSON content: ${result.content.slice(0, 200)}`, { cause });
    }
  };
}
