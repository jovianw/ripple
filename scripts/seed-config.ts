// Seeds harness config v0 (the baseline) and prints the current config. Safe to re-run.
import { client, connect } from "../apps/worker/src/db.ts";
import { currentConfig, seedBaseline } from "../apps/worker/src/harness/config.ts";

await connect();
await seedBaseline();
const current = await currentConfig();
console.log(`current harness config: v${current.version} (${current.verdict})`);
console.log(JSON.stringify(current, null, 2));
await client.close();
