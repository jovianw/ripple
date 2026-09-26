// summarizeBatch: the meta-agent must see causes, not just check names. Run: npm run test:meta
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

process.env.MONGODB_URI ??= "mongodb://localhost:27017"; // db.ts throws at import without it; nothing connects here.
let summarizeBatch: typeof import("./meta.js").summarizeBatch;
before(async () => ({ summarizeBatch } = await import("./meta.js")));

const run = (specId: string, failures: { check: string; detail: string }[], critic?: { diagnosis: { check: string; cause: string }[]; lessons: { pattern: string; fix: string }[] }) => ({
  specId, boardId: `b_${specId}`, attempts: 2,
  runResult: { board_id: `b_${specId}`, harness_version: 0, stage: "checks", passed: failures.length === 0, failures, drc_errors: 0, cost_usd: 0.01, ts: "" },
  criticResults: critic ? [{ ...critic, lessons_ignored: [], escalate: false, rejected_lessons: [], saved_lesson_ids: [] }] : [],
});

describe("summarizeBatch", () => {
  test("groups the same cause across boards and surfaces diagnoses, lessons and current rules", () => {
    const batch = [
      run("t04", [
        { check: "drc", detail: "pcb_courtyard_overlap_error: Courtyard of U1 overlaps C1" },
        { check: "drc", detail: "pcb_port_not_connected_error: Port [U1.VCC] is not connected to net [V3V3] by a PCB trace." },
      ], { diagnosis: [{ check: "drc", cause: "parts were auto-placed on top of each other so routing was skipped" }], lessons: [{ pattern: "Any board with several parts", fix: "Give every part pcbX/pcbY at least 2mm apart" }] }),
      run("t08", [
        { check: "drc", detail: "pcb_courtyard_overlap_error: Courtyard of U2 overlaps C3" },
        { check: "decoupling", detail: "U2 VCC has no cap within 3mm (nearest C3 at 5.1mm)" },
      ], { diagnosis: [{ check: "drc", cause: "parts were auto-placed on top of each other so routing was skipped" }], lessons: [{ pattern: "Any board with several parts", fix: "Give every part pcbX/pcbY at least 2mm apart" }] }),
      run("t01", []),
    ] as any;
    const s = summarizeBatch(batch, { rules: ["Use only whitelisted parts."] });
    assert.match(s, /1\/3 boards passed/);
    assert.match(s, /- drc: 2\/3 boards/);
    assert.match(s, /\(2x on 2 boards\) drc: pcb_courtyard_overlap_error: Courtyard of PART overlaps PART/);
    assert.match(s, /\(1x on 1 boards\) decoupling: PART VCC has no cap within N \(nearest PART at N\)/);
    assert.match(s, /\(2x\) drc: parts were auto-placed on top of each other/);
    assert.match(s, /\(2x\) Any board with several parts -> Give every part pcbX\/pcbY at least 2mm apart/);
    assert.match(s, /Current rules the coder is already given\n- Use only whitelisted parts\./);
  });

  test("an all-pass batch says so", () => {
    const s = summarizeBatch([run("t01", [])] as any);
    assert.match(s, /1\/1 boards passed/);
    assert.match(s, /\(none — every board passed\)/);
    assert.match(s, /\(no critic calls\)/);
  });
});
