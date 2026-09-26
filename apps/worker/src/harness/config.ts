// Versioned harness config. Owner: Jovian.
// A config is never edited in place: every change is a new document whose `parent` is the version it
// came from, so history, diffs and rollback are all queries. "Current" is the newest kept version.
import type { HarnessConfig } from "@ripple/types";
import { MongoServerError } from "mongodb";
import { col } from "../db.js";

/** v0 for the ablation: the loop plus checks, no learned rules. */
export const BASELINE: HarnessConfig = {
  version: 0,
  parent: null,
  rules: [],
  context: { subcircuits_k: 2, lessons_k: 5, rerank: true, include_last_failure: true },
  tools: {
    route_requires_connectivity: false,
    parts_whitelist: "v1",
    mcp: { planner: [], coder: [], critic: ["find", "aggregate"], meta: ["find", "aggregate"] },
  },
  workflow: { plan_first: false, repair_budget: 3, split_over_parts: 12 },
  routing: { planner: "strong", coder: "cheap", critic: "strong", meta: "strong" },
  verdict: "kept",
  rationale: "Baseline (v0): design loop and hidden checks only.",
};

/** What the meta-agent may change. Each section merges into the parent's, so partial edits are safe. */
export interface ConfigChange {
  rules?: string[];
  context?: Partial<HarnessConfig["context"]>;
  tools?: Partial<Omit<HarnessConfig["tools"], "mcp">> & { mcp?: Partial<HarnessConfig["tools"]["mcp"]> };
  workflow?: Partial<HarnessConfig["workflow"]>;
  routing?: Partial<HarnessConfig["routing"]>;
}

const withoutId = ({ _id, ...config }: HarnessConfig & { _id?: unknown }): HarnessConfig => config;

/** Inserts v0 if it isn't there yet. Safe to call repeatedly. */
export async function seedBaseline() {
  await col.harness.updateOne({ version: 0 }, { $setOnInsert: BASELINE }, { upsert: true });
}

/** The config every run should use: the newest version the gate kept. */
export async function currentConfig(): Promise<HarnessConfig> {
  const config = await col.harness.findOne({ verdict: "kept" }, { sort: { version: -1 } });
  if (!config) throw new Error("no kept harness config; run npm run seed:config");
  return withoutId(config);
}

export async function getConfig(version: number): Promise<HarnessConfig | null> {
  const config = await col.harness.findOne({ version });
  return config && withoutId(config);
}

/** Every version, oldest first, including rejected and rolled-back ones (the evolution history). */
export async function history(): Promise<HarnessConfig[]> {
  return (await col.harness.find({}, { sort: { version: 1 } }).toArray()).map(withoutId);
}

/**
 * Stores a proposed change as a new "pending" version on top of the current config.
 * The gate later sets its scores and verdict; nothing else about it ever changes.
 */
export async function propose(change: ConfigChange, rationale: string): Promise<HarnessConfig> {
  const parent = await currentConfig();
  for (let tries = 0; ; tries++) {
    const [latest] = await col.harness.find({}, { sort: { version: -1 }, limit: 1, projection: { version: 1 } }).toArray();
    const next: HarnessConfig = {
      version: (latest?.version ?? -1) + 1,
      parent: parent.version,
      rules: change.rules ?? parent.rules,
      context: { ...parent.context, ...change.context },
      tools: {
        ...parent.tools,
        ...change.tools,
        mcp: { ...parent.tools.mcp, ...change.tools?.mcp },
      },
      workflow: { ...parent.workflow, ...change.workflow },
      routing: { ...parent.routing, ...change.routing },
      verdict: "pending",
      rationale,
    };
    try {
      await col.harness.insertOne({ ...next });
      return next;
    } catch (err) {
      // Another proposal took this version number first (unique index on version); take the next one.
      if (err instanceof MongoServerError && err.code === 11000 && tries < 5) continue;
      throw err;
    }
  }
}
