// Local verification for coder-loop.ts. Not part of the public API.
// Uses real OpenRouter, Voyage, and Atlas — requires .env to be filled in.
// Run with tsx (coder-loop.ts crosses into checks/, which tsc -b apps/worker
// can't type-check — see apps/worker/tsconfig.json's exclude list):
//   npx tsx --env-file-if-exists=.env apps/worker/src/agents/coder-loop.verify.ts
import { client } from "../db.js";
import { runCheckpointLoop } from "./coder-loop.js";

async function main() {
  const specId = "t01_led_indicator";
  const specText = "A small board powered from a 2-pin header (5V, GND) that lights a red indicator LED at about 3 mA.";

  const result = await runCheckpointLoop(specId, specText);

  console.log(
    JSON.stringify(
      {
        boardId: result.boardId,
        attempts: result.attempts,
        passed: result.runResult.passed,
        failures: result.runResult.failures,
        metrics: result.runResult.metrics,
        model: result.runResult.model,
        cost_usd: result.runResult.cost_usd,
      },
      null,
      2,
    ),
  );

  await client.close();
  if (!result.runResult.passed) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await client.close();
  process.exit(1);
});
