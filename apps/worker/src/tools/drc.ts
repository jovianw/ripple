// Deterministic DRC/design-check summary derived from CircuitJson.
// Does not implement electrical rules (pull-ups, decoupling, etc.) — those
// belong to the hidden checker, not this tool. Only reports what tscircuit's
// own render already flagged as *_error / *_warning elements.
import type { CircuitJson } from "tscircuit";

export interface DrcIssue {
  type: string;
  message?: string;
}

export interface DrcResult {
  passed: boolean;
  errors: DrcIssue[];
  warnings: DrcIssue[];
}

function toIssue(el: CircuitJson[number]): DrcIssue {
  const message = "message" in el && typeof el.message === "string" ? el.message : undefined;
  return { type: el.type, message };
}

export function runDrc(circuitJson: CircuitJson): DrcResult {
  const errors = circuitJson.filter((el) => el.type.endsWith("_error")).map(toIssue);
  const warnings = circuitJson.filter((el) => el.type.endsWith("_warning")).map(toIssue);
  return { passed: errors.length === 0, errors, warnings };
}
