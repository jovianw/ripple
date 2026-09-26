// Local verification for coder-loop.ts. Not part of the public API.
// Uses real OpenRouter, Voyage, and Atlas — requires .env to be filled in.
// Run with:
//   npx tsx --env-file-if-exists=.env apps/worker/src/agents/coder-loop.verify.ts
import { client } from "../db.js";
import { currentConfig } from "../harness/config.js";
import { runBoard } from "./coder-loop.js";

async function main() {
  const specId = process.argv[2] ?? "t01_led_indicator";
  const config = await currentConfig();

  const result = await runBoard(specId, config);

  console.log(
    JSON.stringify(
      {
        specId: result.specId,
        boardId: result.boardId,
        attempts: result.attempts,
        passed: result.runResult.passed,
        failures: result.runResult.failures,
        metrics: result.runResult.metrics,
        model: result.runResult.model,
        cost_usd: result.runResult.cost_usd,
        criticEscalated: result.criticResults.some((c) => c.escalate),
        lessonsWritten: result.criticResults.flatMap((c) => c.saved_lesson_ids),
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
