// Hidden checker entry point: grades a board's Circuit JSON against a spec's expected checks.
import type { AnyCircuitElement } from "circuit-json"
import type { RunResult, CheckFailure } from "@ripple/types"
import type { ExpectedChecks } from "./expected.ts"
import { Netlist } from "./netlist.ts"
import { checkConnectivity } from "./rules/connectivity.ts"
import { checkPullups } from "./rules/pullups.ts"
import { checkDecoupling } from "./rules/decoupling.ts"
import { checkDrc } from "./rules/drc.ts"
import { checkDividers, checkLeds, checkRc, checkResistors, checkSwitches, checkTied } from "./rules/circuit.ts"

export interface RunChecksMeta {
  board_id?: string;
  harness_version?: number;
}

/**
 * Runs every hidden check and returns a RunResult (stage "checks").
 * Checks: connectivity, separate, pullups, decoupling, resistors, tied, leds, divider, rc, switch, drc. Never throws on bad input;
 * a malformed board comes back as failures with details.
 */
export async function runChecks(
  circuitJson: AnyCircuitElement[] | unknown,
  expected: ExpectedChecks,
  meta: RunChecksMeta = {},
): Promise<RunResult> {
  const ts = new Date().toISOString();
  const base = { board_id: meta.board_id ?? "", harness_version: meta.harness_version ?? 0, stage: "checks", ts };
  if (!Array.isArray(circuitJson)) {
    return { ...base, passed: false, drc_errors: 0, failures: [{ check: "input", detail: "circuit JSON is not an array of elements" }] };
  }
  const json = circuitJson as AnyCircuitElement[];
  const net = new Netlist(json);
  const failures: CheckFailure[] = [
    ...checkConnectivity(net, expected),
    ...checkPullups(net, expected),
    ...checkDecoupling(net, expected),
    ...checkResistors(net, expected),
    ...checkTied(net, expected),
    ...checkLeds(net, expected),
    ...checkDividers(net, expected),
    ...checkRc(net, expected),
    ...checkSwitches(net, expected),
  ];
  const drc = await checkDrc(json, expected);
  failures.push(...drc.failures);
  // A part can match several rules (the SHT40 is both a temp and a humidity sensor); report each problem once.
  const seen = new Set<string>();
  const unique = failures.filter((f) => { const k = `${f.check}|${f.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });
  failures.length = 0;
  failures.push(...unique);
  return { ...base, passed: failures.length === 0, failures, drc_errors: drc.drc_errors };
}

/** Check names (as they appear in `failures[].check`) that `expected` actually grades. drc always runs. */
export function appliedChecks(expected: ExpectedChecks): string[] {
  const has = (...lists: (unknown[] | object | undefined)[]) =>
    lists.some((l) => (Array.isArray(l) ? l.length > 0 : l !== undefined));
  const applied: [string, boolean][] = [
    ["connectivity", has(expected.nets)],
    ["separate", has(expected.separate)],
    ["pullups", has(expected.i2c)],
    ["decoupling", has(expected.decoupling)],
    ["resistors", has(expected.resistors)],
    ["tied", has(expected.tied)],
    ["leds", has(expected.leds, expected.led_paths, expected.led_drivers)],
    ["divider", has(expected.dividers)],
    ["rc", has(expected.rc)],
    ["switch", has(expected.switches)],
    ["drc", true],
  ];
  return applied.filter(([, on]) => on).map(([name]) => name);
}

/**
 * Partial credit for one graded board: the share of applied check categories with no failure (0..1).
 * A board that couldn't be read at all ("input") scores 0. Throws on a failure from a category `expected`
 * doesn't apply, which means appliedChecks has drifted from the rules. Scoring only: never shown to agents.
 */
export function checkScore(result: Pick<RunResult, "failures">, expected: ExpectedChecks): number {
  if (result.failures.some((f) => f.check === "input")) return 0;
  const applied = appliedChecks(expected);
  const failed = new Set(result.failures.map((f) => f.check));
  const unknown = [...failed].filter((c) => !applied.includes(c));
  if (unknown.length) throw new Error(`checkScore: failures from checks this spec doesn't apply: ${unknown.join(", ")}`);
  return 1 - failed.size / applied.length;
}
