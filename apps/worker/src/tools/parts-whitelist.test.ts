// Proves every whitelisted part renders through the pinned tscircuit with no errors.
// Run: npm run test:parts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { RootCircuit } from "tscircuit";
import { partsWhitelist, isWhitelisted, partExample, partsWhitelistPrompt, getPart } from "./parts-whitelist.js";

async function renderPart(p: (typeof partsWhitelist)[number]) {
  const circuit = new RootCircuit();
  const props = { name: "X1", ...(p.exampleProps ?? {}), ...(p.props ?? {}), footprint: p.footprint };
  circuit.add(createElement("board", { width: "30mm", height: "30mm" }, createElement(p.element, props)));
  await circuit.renderUntilSettled();
  return circuit.getCircuitJson() as Array<{ type: string; message?: string; name?: string }>;
}

describe("parts whitelist", () => {
  test("ids are unique", () => {
    const ids = partsWhitelist.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("helpers", () => {
    assert.equal(isWhitelisted("resistor", "0603"), true);
    assert.equal(isWhitelisted("chip", "qfn32_w5_h5_p0.5"), false);
    assert.equal(partExample(getPart("res-0603")!, "R1"), '<resistor name="R1" resistance="10k" footprint="0603" />');
    assert.match(partsWhitelistPrompt(), /## mcu/);
    assert.match(partsWhitelistPrompt(), /<chip name="X1" pinLabels=\{/);
  });

  for (const p of partsWhitelist) {
    test(`${p.id} renders with pads and no errors`, async () => {
      const json = await renderPart(p);
      const errors = json.filter((e) => e.type.endsWith("_error")).map((e) => `${e.type}: ${e.message}`);
      assert.deepEqual(errors, []);
      assert.equal(json.filter((e) => e.type === "pcb_component").length, 1);
      assert.ok(json.filter((e) => e.type === "pcb_smtpad" || e.type === "pcb_plated_hole").length > 0, "no pads");
      if (p.pins) {
        const ports = json.filter((e) => e.type === "source_port").map((e) => e.name);
        assert.deepEqual(ports, p.pins);
      }
    });
  }
});
