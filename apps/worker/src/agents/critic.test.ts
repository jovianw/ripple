// Critic agent tests with a fake model: prompt content, reply parsing, retries, lesson hygiene.
// Run: npm run test:critic
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCritic, buildMessages, failureSummary, parseReply, sanitizeLessons, CriticError, type CallModel, type ModelCall } from "./critic.js";
import { spec, failingCode, failedResult, config } from "./critic.fixture.js";

const goodReply = {
  diagnosis: "The I2C lines have no pull-ups, the sensor has no decoupling, and its address pins float.",
  fix_description: "Add 4.7k pull-ups on SDA and SCL, a 100nF cap on VCC, and tie A0-A2 to GND.",
  patched_code: failingCode.replace("  </board>", `    <resistor name="R1" resistance="4.7k" footprint="0603" pcbX={-4} pcbY={6} />
    <trace from=".R1 > .pin1" to="net.SDA" />
    <trace from=".R1 > .pin2" to="net.V3V3" />
  </board>`),
  lessons: [
    { pattern: "I2C bus without pull-up resistors", fix: "Add a 2.2k-10k resistor from SDA and from SCL to the supply rail" },
    { pattern: "Chip supply pin without decoupling", fix: "Place a 100nF capacitor from the supply pin to ground within 3mm" },
    { pattern: "Extra lesson beyond the cap", fix: "should be dropped" },
  ],
  failure_summary: "I2C sensor breakout missing pull-ups, decoupling and address pin ties",
};

/** A fake model that returns the given replies in order and records every call. */
function fakeModel(replies: string[]): { call: CallModel; calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  const call: CallModel = async (input) => {
    calls.push({ ...input, messages: [...input.messages] });
    const content = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { content, model: "fake/model", tier: input.config.routing[input.role], totalTokens: 100, costUsd: 0.001 };
  };
  return { call, calls };
}

describe("critic", () => {
  test("failureSummary groups failures per check, deterministically", () => {
    const s = failureSummary(spec, failedResult);
    assert.equal(s, failureSummary(spec, failedResult));
    assert.match(s, /^t04_i2c_temp_breakout: pullups \(2\): SDA .*; SCL .* \| decoupling \(1\): .* \| tied \(3\): .*; \.\.\.$/);
  });

  test("prompt carries spec, rules, lessons, similar failures, grouped failures and the code", () => {
    const [system, user] = buildMessages({
      spec, code: failingCode, result: failedResult, config,
      lessons: [{ pattern: "Known thing", fix: "Do it" }],
      similarFailures: ["t08: pullups missing"],
      callModel: fakeModel([]).call,
    });
    assert.equal(system.role, "system");
    assert.match(system.content, /SMALLEST fix/);
    assert.match(user.content, /Spec \(t04_i2c_temp_breakout\):\nA breakout for an I2C/);
    assert.match(user.content, /Rules the coder must follow:\n- Use only whitelisted parts/);
    assert.match(user.content, /do not repeat these\):\n- Known thing -> Do it/);
    assert.match(user.content, /Similar past failures:\n- t08: pullups missing/);
    assert.match(user.content, /pullups:\n  - SDA \(header:SDA\) has no pull-up/);
    assert.match(user.content, /tied:\n  - role:temp_sensor A0/);
    assert.match(user.content, /Failing code:\nexport default/);
  });

  test("parseReply tolerates fences and prose", () => {
    assert.deepEqual(parseReply('Sure!\n```json\n{"diagnosis":"x"}\n```\nDone.'), { diagnosis: "x" });
    assert.deepEqual(parseReply('prefix {"a":1} suffix'), { a: 1 });
    assert.throws(() => parseReply("no json here"), CriticError);
  });

  test("sanitizeLessons drops empties and duplicates and caps at two", () => {
    const out = sanitizeLessons(
      [{ pattern: " Known thing ", fix: "x" }, { pattern: "", fix: "y" }, { pattern: "A", fix: "a" }, { pattern: "a", fix: "dup" }, { pattern: "B", fix: "b" }, { pattern: "C", fix: "c" }],
      [{ pattern: "known thing", fix: "already" }],
    );
    assert.deepEqual(out, [{ pattern: "A", fix: "a" }, { pattern: "B", fix: "b" }]);
  });

  test("runCritic returns diagnosis, fix, deduplicated lessons and usage", async () => {
    const model = fakeModel(["```json\n" + JSON.stringify(goodReply) + "\n```"]);
    const r = await runCritic({ spec, code: failingCode, result: failedResult, config, lessons: [{ pattern: "I2C bus without pull-up resistors", fix: "old" }], callModel: model.call });
    assert.equal(model.calls.length, 1);
    assert.equal(model.calls[0].role, "critic");
    assert.equal(r.diagnosis, goodReply.diagnosis);
    assert.equal(r.fix.description, goodReply.fix_description);
    assert.match(r.fix.code, /<resistor name="R1"/);
    assert.deepEqual(r.lessons, [{ pattern: "Chip supply pin without decoupling", fix: "Place a 100nF capacitor from the supply pin to ground within 3mm" }, { pattern: "Extra lesson beyond the cap", fix: "should be dropped" }]);
    assert.equal(r.failure_summary, goodReply.failure_summary);
    assert.deepEqual(r.model, { model: "fake/model", tier: "strong", tokens: 100, cost_usd: 0.001, calls: 1 });
    assert.equal(r.verified, undefined);
  });

  test("retries once when the reply is not usable JSON, and gives up after three", async () => {
    const model = fakeModel(["I think the problem is pull-ups.", JSON.stringify(goodReply)]);
    const r = await runCritic({ spec, code: failingCode, result: failedResult, config, callModel: model.call });
    assert.equal(r.model.calls, 2);
    const retry = model.calls[1].messages.at(-1)!;
    assert.equal(retry.role, "user");
    assert.match(retry.content, /could not be used: reply contains no JSON object/);

    const bad = fakeModel([JSON.stringify({ diagnosis: "x", patched_code: "no board here" })]);
    await assert.rejects(runCritic({ spec, code: failingCode, result: failedResult, config, callModel: bad.call }), (e: CriticError) => {
      assert.match(e.message, /no usable reply after 3 calls: patched_code has no <board>/);
      return true;
    });
    assert.equal(bad.calls.length, 3);
  });

  test("with an evaluator, a patch that does not render is sent back once with the errors", async () => {
    const broken = { ...goodReply, patched_code: goodReply.patched_code.replace('resistance="4.7k"', 'resistance="BAD"') };
    const model = fakeModel([JSON.stringify(broken), JSON.stringify(goodReply)]);
    const evaluate = async (code: string) => ({ errors: code.includes("BAD") ? [{ type: "source_component_error", message: "Invalid resistance BAD" }] : [] });
    const r = await runCritic({ spec, code: failingCode, result: failedResult, config, callModel: model.call, evaluate });
    assert.equal(r.model.calls, 2);
    assert.match(model.calls[1].messages.at(-1)!.content, /does not render:\n- source_component_error: Invalid resistance BAD/);
    assert.deepEqual(r.verified, { rendered: true, errors: [] });
    assert.equal(r.model.cost_usd, 0.002);
  });

  test("falls back to the deterministic summary when the model gives none", async () => {
    const model = fakeModel([JSON.stringify({ ...goodReply, failure_summary: "", lessons: "not a list" })]);
    const r = await runCritic({ spec, code: failingCode, result: failedResult, config, callModel: model.call });
    assert.equal(r.failure_summary, failureSummary(spec, failedResult));
    assert.deepEqual(r.lessons, []);
  });
});
