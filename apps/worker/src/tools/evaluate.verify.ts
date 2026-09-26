// Local verification for evaluate.ts. Not part of the public API.
// Run after `npm run typecheck`: node apps/worker/dist/tools/evaluate.verify.js
import { evaluateCircuitSource } from "./evaluate.js";
import { runDrc } from "./drc.js";
import { computeMetrics } from "./metrics.js";

const source = `
export default () => (
  <board>
    <resistor name="R1" resistance="1k" footprint="0402" />
    <capacitor name="C1" capacitance="1000pF" footprint="0402" />
    <trace from=".R1 > .pin1" to=".C1 > .pin1" />
  </board>
)
`;

async function main() {
  const { circuitJson } = await evaluateCircuitSource(source);
  const drc = runDrc(circuitJson);
  const metrics = computeMetrics(circuitJson);

  const nonEmpty = circuitJson.length > 0;
  const hasPcbTrace = circuitJson.some((el) => el.type === "pcb_trace");
  const drcOk = drc.passed && drc.errors.length === 0;
  const traceLengthPositive = metrics.trace_mm > 0;
  const ok = nonEmpty && hasPcbTrace && drcOk && traceLengthPositive;

  console.log(
    JSON.stringify(
      { elementCount: circuitJson.length, nonEmpty, hasPcbTrace, drcOk, metrics, traceLengthPositive, ok },
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
