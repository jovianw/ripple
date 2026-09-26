// Local verification for drc.ts and metrics.ts. Not part of the public API.
// Run after `npm run typecheck`: node apps/worker/dist/tools/drc-metrics.verify.js
import { compileCircuit } from "./compile.js";
import { runDrc } from "./drc.js";
import { computeMetrics } from "./metrics.js";

async function main() {
  const circuit = (
    <board>
      <resistor name="R1" resistance="1k" footprint="0402" />
      <capacitor name="C1" capacitance="1000pF" footprint="0402" />
      <trace from=".R1 > .pin1" to=".C1 > .pin1" />
    </board>
  );

  const { circuitJson } = await compileCircuit(circuit);
  const drc = runDrc(circuitJson);
  const metrics = computeMetrics(circuitJson);

  const drcOk = drc.passed && drc.errors.length === 0;
  const viasValid = Number.isFinite(metrics.vias) && metrics.vias >= 0;
  const traceLengthPositive = metrics.trace_mm > 0;
  const areaValid = metrics.area_mm2 === undefined || metrics.area_mm2 > 0;
  const ok = drcOk && viasValid && traceLengthPositive && areaValid;

  console.log(JSON.stringify({ drc, metrics, drcOk, viasValid, traceLengthPositive, areaValid, ok }, null, 2));

  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
