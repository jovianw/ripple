// Local verification for compile.ts. Not part of the public API.
// Run after `npm run typecheck`: node apps/worker/dist/tools/compile.verify.js
import { compileCircuit } from "./compile.js";

async function main() {
  const circuit = (
    <board>
      <resistor name="R1" resistance="1k" footprint="0402" />
      <capacitor name="C1" capacitance="1000pF" footprint="0402" />
      <trace from=".R1 > .pin1" to=".C1 > .pin1" />
    </board>
  );

  const { circuitJson, errors } = await compileCircuit(circuit);

  const nonEmpty = circuitJson.length > 0;
  const hasPcbTrace = circuitJson.some((el) => el.type === "pcb_trace");
  const noErrors = errors.length === 0;
  const ok = nonEmpty && hasPcbTrace && noErrors;

  console.log(
    JSON.stringify(
      { elementCount: circuitJson.length, nonEmpty, hasPcbTrace, errorCount: errors.length, ok },
      null,
      2,
    ),
  );

  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
