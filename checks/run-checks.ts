// Hidden checker entry point: grades a board's Circuit JSON against a spec's expected checks.
import type { AnyCircuitElement } from "circuit-json"
import type { RunResult, CheckFailure } from "@ripple/types"
import type { ExpectedChecks } from "./expected.ts"
import { Netlist } from "./netlist.ts"
import { checkConnectivity } from "./rules/connectivity.ts"
import { checkPullups } from "./rules/pullups.ts"
import { checkDecoupling } from "./rules/decoupling.ts"
import { checkDrc } from "./rules/drc.ts"
import { checkBetween } from "./rules/between.ts"
import { checkSeriesLed } from "./rules/series-led.ts"
import { checkTied } from "./rules/tied.ts"
import { checkDivider, checkRcLowpass } from "./rules/analog.ts"
import { checkDistinctAddresses } from "./rules/addresses.ts"

export interface RunChecksMeta {
  board_id?: string;
  harness_version?: number;
}

/**
 * Runs every hidden check and returns a RunResult (stage "checks").
 * Checks: connectivity, separate, pullups, decoupling, between, series_led, tied, divider,
 * rc_lowpass, addresses, drc. Never throws on bad input;
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
    ...checkBetween(net, expected),
    ...checkSeriesLed(net, expected),
    ...checkTied(net, expected),
    ...checkDivider(net, expected),
    ...checkRcLowpass(net, expected),
    ...checkDistinctAddresses(net, expected),
  ];
  const drc = await checkDrc(json, expected);
  failures.push(...drc.failures);
  return { ...base, passed: failures.length === 0, failures, drc_errors: drc.drc_errors };
}
