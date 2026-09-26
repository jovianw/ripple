// Critic agent: reads a failed run, diagnoses it, proposes the smallest fix, and writes lessons.
// Pure: no database, no network of its own. The model call is injected (tools/router.js once it
// lands) and so is the optional evaluator used to confirm the patched code still renders.
// Memory writes (lessons, failure index) live in critic-memory.ts so this module never touches Atlas.
import type { CheckFailure, HarnessConfig, Lesson, ModelTier, RunResult } from "@ripple/types";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ModelCall { role: "critic"; messages: ChatMessage[]; config: HarnessConfig }
export interface ModelReply {
  content: string;
  model: string;
  tier: ModelTier;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}
/** Same shape as callModel in tools/router.ts. */
export type CallModel = (input: ModelCall) => Promise<ModelReply>;
/** Renders tscircuit source; resolves with render errors (empty when it renders clean), rejects when it cannot run. */
export type Evaluate = (code: string) => Promise<{ errors: { type: string; message?: string }[] }>;

export interface CriticInput {
  spec: { _id: string; text: string };
  /** The tscircuit source that failed. */
  code: string;
  /** The failed RunResult (stage "checks" or "drc"). */
  result: RunResult;
  config: HarnessConfig;
  /** Lessons already in the coder's context; the critic won't repeat them. */
  lessons?: Pick<Lesson, "pattern" | "fix">[];
  /** Summaries of similar past failures (episodic memory), if any. */
  similarFailures?: string[];
  callModel: CallModel;
  evaluate?: Evaluate;
}

export interface CriticLesson { pattern: string; fix: string }

export interface CriticResult {
  diagnosis: string;
  fix: { description: string; code: string };
  /** 0-2 general design rules learned from this failure, deduplicated against input.lessons. */
  lessons: CriticLesson[];
  /** Short searchable description of the failure, for the runs index. */
  failure_summary: string;
  /** Present when an evaluator was given: did the patched code render? */
  verified?: { rendered: boolean; errors: string[] };
  model: { model: string; tier: ModelTier; tokens?: number; cost_usd?: number; calls: number };
}

export class CriticError extends Error {
  constructor(message: string, readonly raw?: string) { super(message); this.name = "CriticError"; }
}

const MAX_CALLS = 3;
const MAX_LESSONS = 2;

export const CRITIC_SYSTEM_PROMPT = `You are the critic in an automated PCB design loop. A coder wrote a tscircuit board for a spec; a checker you cannot see graded it and reported failures. Your job:

1. Diagnose the root cause in plain language (one short paragraph).
2. Propose the SMALLEST fix: edit the given code, keep every component name and the overall structure, add or change only what the failures require. Use only tscircuit's built-in JSX (<board>, <resistor>, <capacitor>, <led>, <chip>, <pinheader>, <trace>...). No imports. Reference pins as ".R1 > .pin1"; named nets as "net.GND".
3. Extract at most two LESSONS: general design rules that would prevent this class of failure on any board (pattern -> fix). A lesson must not mention this spec, these component names, or the checker. Do not repeat lessons you were given. Return an empty list when nothing general was learned.
4. Write a one-line failure summary (what was wrong, in circuit terms).

Respond with ONLY a JSON object, no markdown, no prose around it:
{
  "diagnosis": "...",
  "fix_description": "one or two sentences",
  "patched_code": "the complete corrected tscircuit module, starting with export default",
  "lessons": [{ "pattern": "...", "fix": "..." }],
  "failure_summary": "..."
}`;

function groupFailures(failures: CheckFailure[]): Map<string, string[]> {
  const g = new Map<string, string[]>();
  for (const f of failures) g.set(f.check, [...(g.get(f.check) ?? []), f.detail]);
  return g;
}

/** Deterministic one-line summary of a failed run, used to retrieve lessons and similar failures. */
export function failureSummary(spec: { _id: string }, result: RunResult): string {
  const parts: string[] = [];
  for (const [check, details] of groupFailures(result.failures)) {
    const shown = details.slice(0, 2).map((d) => d.replace(/\s+/g, " ").trim());
    parts.push(`${check} (${details.length}): ${shown.join("; ")}${details.length > 2 ? "; ..." : ""}`);
  }
  if (result.drc_errors > 0 && !parts.some((p) => p.startsWith("drc"))) parts.push(`drc_errors: ${result.drc_errors}`);
  return `${spec._id}: ${parts.join(" | ") || "failed without details"}`.slice(0, 600);
}

export function buildMessages(input: CriticInput): ChatMessage[] {
  const sections: string[] = [];
  sections.push(`Spec (${input.spec._id}):\n${input.spec.text}`);
  if (input.config.rules.length) sections.push(`Rules the coder must follow:\n${input.config.rules.map((r) => `- ${r}`).join("\n")}`);
  if (input.lessons?.length) sections.push(`Lessons the coder already had (do not repeat these):\n${input.lessons.map((l) => `- ${l.pattern} -> ${l.fix}`).join("\n")}`);
  if (input.similarFailures?.length) sections.push(`Similar past failures:\n${input.similarFailures.map((s) => `- ${s}`).join("\n")}`);
  const failures = [...groupFailures(input.result.failures)].map(([check, details]) => `${check}:\n${details.map((d) => `  - ${d}`).join("\n")}`).join("\n");
  sections.push(`Checker failures (stage ${input.result.stage}, ${input.result.drc_errors} DRC errors):\n${failures || "(no details)"}`);
  sections.push(`Failing code:\n${input.code}`);
  return [
    { role: "system", content: CRITIC_SYSTEM_PROMPT },
    { role: "user", content: sections.join("\n\n") },
  ];
}

interface RawReply { diagnosis?: unknown; fix_description?: unknown; patched_code?: unknown; lessons?: unknown; failure_summary?: unknown }

/** Pulls the JSON object out of a model reply, tolerating code fences and surrounding prose. */
export function parseReply(content: string): RawReply {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new CriticError("reply contains no JSON object", content);
  try {
    return JSON.parse(text.slice(start, end + 1)) as RawReply;
  } catch (e) {
    throw new CriticError(`reply is not valid JSON: ${(e as Error).message}`, content);
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function sanitizeLessons(raw: unknown, existing: Pick<Lesson, "pattern" | "fix">[] = []): CriticLesson[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(existing.map((l) => l.pattern.trim().toLowerCase()));
  const out: CriticLesson[] = [];
  for (const item of raw) {
    const pattern = str((item as CriticLesson)?.pattern).slice(0, 200);
    const fix = str((item as CriticLesson)?.fix).slice(0, 300);
    if (!pattern || !fix) continue;
    const key = pattern.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pattern, fix });
    if (out.length >= MAX_LESSONS) break;
  }
  return out;
}

function validate(raw: RawReply): { diagnosis: string; description: string; code: string; summary: string } {
  const code = str(raw.patched_code).replace(/^```(?:tsx|jsx|ts|js)?\n?|```$/g, "").trim();
  const problems: string[] = [];
  if (!str(raw.diagnosis)) problems.push("diagnosis is empty");
  if (!code) problems.push("patched_code is empty");
  else if (!/<board\b/.test(code)) problems.push("patched_code has no <board>");
  else if (!/export\s+default/.test(code)) problems.push("patched_code has no default export");
  if (problems.length) throw new CriticError(problems.join("; "));
  return { diagnosis: str(raw.diagnosis), description: str(raw.fix_description), code, summary: str(raw.failure_summary) };
}

export async function runCritic(input: CriticInput): Promise<CriticResult> {
  const messages = buildMessages(input);
  const usage = { model: "", tier: input.config.routing.critic, tokens: 0, cost_usd: 0, calls: 0, sawTokens: false, sawCost: false };
  let last: CriticError | undefined;
  let verified: CriticResult["verified"];

  for (let attempt = 0; attempt < MAX_CALLS; attempt++) {
    const reply = await input.callModel({ role: "critic", messages, config: input.config });
    usage.calls++;
    usage.model = reply.model;
    usage.tier = reply.tier;
    if (reply.totalTokens != null) { usage.tokens += reply.totalTokens; usage.sawTokens = true; }
    if (reply.costUsd != null) { usage.cost_usd += reply.costUsd; usage.sawCost = true; }

    let parsed: ReturnType<typeof validate>;
    let raw: RawReply;
    try {
      raw = parseReply(reply.content);
      parsed = validate(raw);
    } catch (e) {
      last = e instanceof CriticError ? e : new CriticError(String(e));
      messages.push({ role: "assistant", content: reply.content });
      messages.push({ role: "user", content: `That reply could not be used: ${last.message}. Respond again with ONLY the JSON object described, including the complete patched_code.` });
      continue;
    }

    if (input.evaluate) {
      let errors: string[];
      try {
        errors = (await input.evaluate(parsed.code)).errors.map((e) => `${e.type}: ${e.message ?? ""}`.trim());
      } catch (e) {
        errors = [`evaluation failed: ${(e as Error).message}`];
      }
      verified = { rendered: errors.length === 0, errors };
      if (errors.length && attempt < MAX_CALLS - 1) {
        messages.push({ role: "assistant", content: reply.content });
        messages.push({ role: "user", content: `Your patched_code does not render:\n${errors.slice(0, 10).map((e) => `- ${e}`).join("\n")}\nFix that and respond again with ONLY the JSON object.` });
        continue;
      }
    }

    return {
      diagnosis: parsed.diagnosis,
      fix: { description: parsed.description, code: parsed.code },
      lessons: sanitizeLessons(raw.lessons, input.lessons),
      failure_summary: parsed.summary || failureSummary(input.spec, input.result),
      verified,
      model: { model: usage.model, tier: usage.tier, tokens: usage.sawTokens ? usage.tokens : undefined, cost_usd: usage.sawCost ? usage.cost_usd : undefined, calls: usage.calls },
    };
  }
  throw new CriticError(`critic gave no usable reply after ${MAX_CALLS} calls: ${last?.message ?? "unknown"}`, last?.raw);
}
