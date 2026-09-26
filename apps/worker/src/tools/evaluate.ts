// Evaluates LLM-generated tscircuit TSX source text into CircuitJson using
// tscircuit's own CircuitRunner (sucrase transpile + render, internal to the
// library). @tscircuit/eval has no public API that stops at a bare
// ReactElement — it goes straight from source text to CircuitJson — so this
// does not go through compileCircuit(); the output feeds runDrc()/
// computeMetrics() exactly like compileCircuit()'s output does.
// CDN-based npm import resolution is disabled: generated code should only
// use tscircuit's built-in JSX intrinsics, not arbitrary network imports.
import { CircuitRunner } from "tscircuit";
import type { CompileResult } from "./compile.js";
import { clearLabels } from "./placement.js";

export class EvaluateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EvaluateError";
  }
}

export async function evaluateCircuitSource(source: string): Promise<CompileResult> {
  const runner = new CircuitRunner();

  try {
    await runner.setDisableCdnLoading(true);
    // Without this, eval attaches JLCPCB supplier parts; the 0603 LED's
    // supplier part has reversed pin-1 polarity and fails DRC even on a
    // correct board (same fix as assembler.ts).
    await runner.setPlatformConfigProperty("partsEngineDisabled", true);
    // execute() expects source that imperatively calls circuit.add(...);
    // executeWithFsMap() auto-wraps a default-exported component instead,
    // matching the `export default () => (<board>...)` pattern LLMs write.
    await runner.executeWithFsMap({ fsMap: { "index.tsx": source } });
    await runner.renderUntilSettled();
  } catch (cause) {
    throw new EvaluateError("tscircuit evaluation failed", { cause });
  }

  // Part-name labels moved off other parts and pads (silkscreen only; nothing else changes).
  const circuitJson = clearLabels(await runner.getCircuitJson());
  const errors = circuitJson.filter((el) => el.type.endsWith("_error"));

  return { circuitJson, errors };
}
