// Kill-and-resume demo for the work queue, with a stand-in handler (each step just waits).
//   npm run queue:demo              start or resume the demo board
//   npm run queue:demo -- --reset   delete the demo board's queue items and runs first
// Kill it mid-run (Ctrl+C), run it again: it resumes from the queue and every step runs exactly once to done.
import type { RunResult } from "@ripple/types";
import { setTimeout as sleep } from "node:timers/promises";
import { client, col, connect } from "../apps/worker/src/db.ts";
import { currentConfig } from "../apps/worker/src/harness/config.ts";
import { enqueue, progress, runQueue } from "../apps/worker/src/harness/queue.ts";

const BOARD = process.env.DEMO_BOARD || "demo-queue";
const STEP_MS = Number(process.env.DEMO_STEP_MS || 3000);

await connect();
if (process.argv.includes("--reset")) {
  const q = await col.queue.deleteMany({ board_id: BOARD });
  const r = await col.runs.deleteMany({ board_id: BOARD });
  console.log(`reset: removed ${q.deletedCount} queue items, ${r.deletedCount} runs`);
}

// The finale board from the brief, split the way the planner would.
await enqueue(BOARD, [
  { key: "usb-power", title: "USB-C 5V input" },
  { key: "regulator", title: "3.3V regulator", depends_on: ["usb-power"] },
  { key: "mcu", title: "Microcontroller with decoupling", depends_on: ["regulator"] },
  { key: "sensor-a", title: "I2C temperature sensor", depends_on: ["mcu"] },
  { key: "sensor-b", title: "I2C light sensor", depends_on: ["mcu"] },
  { key: "leds", title: "Status LEDs", depends_on: ["mcu"] },
  { key: "assemble", title: "Assemble and route full board", depends_on: ["sensor-a", "sensor-b", "leds"] },
]);

const config = await currentConfig();
const result = await runQueue(
  BOARD,
  async (item) => {
    await sleep(STEP_MS);
    const run: RunResult = {
      board_id: BOARD,
      harness_version: config.version,
      stage: item.key === "assemble" ? "final" : "checks",
      passed: true,
      failures: [],
      drc_errors: 0,
      ts: new Date().toISOString(),
    };
    return { run };
  },
  { log: (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`) },
);

const p = await progress(BOARD);
console.log(`board ${BOARD}: ${p.done}/${p.total} done, ${p.failed} failed, ${p.pending} pending`);
console.log(`runs stored for this board: ${await col.runs.countDocuments({ board_id: BOARD })}`);
await client.close();
process.exit(result.failed ? 1 : 0);
