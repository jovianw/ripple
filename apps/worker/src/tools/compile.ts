// Compiles a tscircuit component tree into Circuit JSON.
// Direct library API (RootCircuit) — render() performs autorouting, so no
// separate autoroute step is needed here.
import type { ReactElement } from "react";
import { RootCircuit, type CircuitJson } from "tscircuit";

export interface CompileResult {
  circuitJson: CircuitJson;
  errors: CircuitJson;
}

export class CompileError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CompileError";
  }
}

export async function compileCircuit(circuit: ReactElement): Promise<CompileResult> {
  const root = new RootCircuit();

  try {
    root.add(circuit);
    await root.renderUntilSettled();
  } catch (cause) {
    throw new CompileError("tscircuit render failed", { cause });
  }

  const circuitJson = root.getCircuitJson();
  const errors = circuitJson.filter((el) => el.type.endsWith("_error"));

  return { circuitJson, errors };
}
