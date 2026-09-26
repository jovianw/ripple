// Routing and design rules: render/autoroute errors already in the Circuit JSON,
// plus everything @tscircuit/checks reports as an error (warnings are ignored).
import type { AnyCircuitElement } from "circuit-json"
import { runAllChecks } from "@tscircuit/checks"
import type { CheckFailure } from "@board-forge/types"
import type { ExpectedChecks } from "../expected.ts"

const MAX_LISTED = 10;

export async function checkDrc(json: AnyCircuitElement[], expected: ExpectedChecks): Promise<{ failures: CheckFailure[]; drc_errors: number }> {
  const maxErrors = expected.drc?.max_errors ?? 0;
  const inJson = json.filter((e) => e.type.endsWith("_error"));
  let fromChecks: AnyCircuitElement[] = [];
  try {
    fromChecks = (await runAllChecks(json)).filter((e) => e.type.endsWith("_error")) as AnyCircuitElement[];
  } catch (err) {
    return { failures: [{ check: "drc", detail: `DRC could not run: ${(err as Error).message}` }], drc_errors: 1 };
  }
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const e of [...inJson, ...fromChecks]) {
    const msg = `${e.type}: ${(e as { message?: string }).message ?? "(no message)"}`;
    if (seen.has(msg)) continue;
    seen.add(msg);
    errors.push(msg);
  }
  const failures: CheckFailure[] = [];
  if (errors.length > maxErrors) {
    for (const msg of errors.slice(0, MAX_LISTED)) failures.push({ check: "drc", detail: msg });
    if (errors.length > MAX_LISTED) failures.push({ check: "drc", detail: `...and ${errors.length - MAX_LISTED} more DRC errors` });
  }
  return { failures, drc_errors: errors.length };
}
