// Assembles the finale reference from its three groups and grades it with the hidden checker.
// Run: npm run test:assembler
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assemble, packBoxes, findExportName, type Subcircuit } from "./assembler.js";

const whitelist = JSON.parse(readFileSync("parts/whitelist.json", "utf8")) as { parts: { id: string; props: unknown }[] };
const finaleSource = readFileSync("checks/reference/finale.tsx", "utf8");

/** Turns `export const Name = () => (<group>...</group>)` from finale.tsx into a self-contained code string. */
function groupCode(exportName: string): string {
  const m = finaleSource.match(new RegExp(`export const ${exportName} = \\(\\) => \\([\\s\\S]*?\\n\\)\\n`));
  if (!m) throw new Error(`${exportName} not found in finale.tsx`);
  return m[0].replace(/\{\.\.\.part\("([^"]+)"\)\}/g, (_, id) => {
    const p = whitelist.parts.find((p) => p.id === id);
    if (!p) throw new Error(`part ${id} not in whitelist`);
    return `{...(${JSON.stringify(p.props)})}`;
  });
}

const power: Subcircuit = { name: "power", code: groupCode("FinalePower") };
const mcu: Subcircuit = { name: "mcu", code: groupCode("FinaleMcu") };
const sensors: Subcircuit = { name: "sensors", code: groupCode("FinaleSensors") };

const overlaps = (a: { minX: number; maxX: number; minY: number; maxY: number }, b: typeof a) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

describe("assembler", () => {
  test("finds the named export and rejects boards and imports", () => {
    assert.equal(findExportName(power), "FinalePower");
    assert.throws(() => findExportName({ name: "x", code: "export default () => <group name='x' />" }), /no named export/);
  });

  test("packs boxes without overlap", () => {
    const boxes = Array.from({ length: 7 }, (_, i) => ({ name: `g${i}`, box: { minX: -i - 1, maxX: i + 1, minY: -2, maxY: 2 + i } }));
    const centers = packBoxes(boxes, 2);
    const placed = boxes.map((b) => {
      const c = centers.get(b.name)!; const w = b.box.maxX - b.box.minX, h = b.box.maxY - b.box.minY;
      return { minX: c.cx - w / 2, maxX: c.cx + w / 2, minY: c.cy - h / 2, maxY: c.cy + h / 2 };
    });
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!overlaps(placed[i], placed[j]), `${i} overlaps ${j}`);
  });

  test("assembles power + mcu + sensors into a board that passes the finale checks", async () => {
    const r = await assemble([power, mcu, sensors], { specId: "finale" });
    assert.ok(r.result, "graded");
    assert.deepEqual(r.result!.failures, []);
    assert.equal(r.result!.passed, true);
    assert.equal(r.result!.drc_errors, 0);
    assert.equal(r.layout.length, 3);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!overlaps(r.layout[i].box, r.layout[j].box), "groups overlap");
    for (const p of r.layout) {
      assert.ok(Math.abs(p.box.minX) <= r.board.widthMm / 2 && Math.abs(p.box.maxX) <= r.board.widthMm / 2, `${p.name} outside board width`);
      assert.ok(Math.abs(p.box.minY) <= r.board.heightMm / 2 && Math.abs(p.box.maxY) <= r.board.heightMm / 2, `${p.name} outside board height`);
    }
    assert.match(r.code, /<board width="\d+mm" height="\d+mm">/);
    assert.match(r.code, /<FinalePower \/>/);
    assert.equal(r.circuitJson.filter((e) => e.type === "pcb_component").length, 20);
    // Deterministic: same inputs, same code.
    const again = await assemble([power, mcu, sensors]);
    assert.equal(again.code, r.code);
  });

  test("a missing group fails the checks with clear details", async () => {
    const r = await assemble([power, mcu], { specId: "finale" });
    assert.ok(r.result);
    assert.equal(r.result!.passed, false);
    assert.ok(r.result!.failures.length > 0);
    for (const f of r.result!.failures) { assert.ok(f.check.length > 0); assert.ok(f.detail.length > 10, f.detail); }
    const text = r.result!.failures.map((f) => `${f.check}: ${f.detail}`).join("\n");
    assert.match(text, /temp_sensor|humidity_sensor/);
  });

  test("rejects a subcircuit that is not a group", async () => {
    await assert.rejects(assemble([{ name: "bad", code: 'export const Bad = () => (<board width="10mm" height="10mm" />)' }]), /must return a <group/);
  });
});
