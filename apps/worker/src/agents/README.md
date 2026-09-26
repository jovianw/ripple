# agents

LLM agents of the design loop. Owner of critic and planner: Marcos. Coder and meta-agent: Arjun.

## critic

`runCritic(input)` in [critic.ts](critic.ts) turns a failed run into a diagnosis, the smallest
patched source, up to two general lessons, and a one-line failure summary. It is pure: the model
call (`callModel`, same shape as `tools/router.ts`) and an optional `evaluate` (renders the patch and
returns tscircuit errors) are injected. It retries up to three model calls when a reply is not usable
JSON or the patch does not render.

```ts
import { runCritic, failureSummary } from "./critic.js"
import { criticContext, recordCritic } from "./critic-memory.js"

const summary = failureSummary(spec, failedRun)
const { lessons, similarFailures } = await criticContext(summary, config)   // Atlas: lessons + similar runs
const critic = await runCritic({ spec, code, result: failedRun, config, lessons, similarFailures, callModel, evaluate })
await recordCritic(failedRun.board_id, critic)   // Atlas: addLesson per lesson, indexFailure(summary)
// critic.fix.code goes back to the coder (or straight to compile + checks) within workflow.repair_budget
```

[critic-memory.ts](critic-memory.ts) is the only file here that touches Atlas, through
`harness/memory.ts`. Lessons are idempotent per pattern, so the same lesson learned twice updates
rather than duplicates. `npm run test:critic` runs the tests with a fake model;
`critic.verify.ts` makes one real OpenRouter call on the fixture failure.
