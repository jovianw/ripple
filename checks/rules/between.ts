// Generic two-terminal rule: a part of the given kind bridges nets a and b, optionally within
// a value window and with an exact count. Wildcard sides pass if any candidate net works.
import type { CheckFailure } from "@ripple/types"
import type { BetweenRule, ExpectedChecks } from "../expected.ts"
import { Netlist, bridges, fmtFarads, fmtOhms, type TwoTerminal } from "../netlist.ts"

function valueOk(rule: BetweenRule, t: TwoTerminal): { ok: boolean; have: string } {
  const r = t.comp.resistance;
  const c = t.comp.capacitance;
  if (rule.kind === "resistor") {
    const have = r != null ? `${fmtOhms(r)} ohm` : "unknown";
    if (r == null) return { ok: rule.min_ohms == null && rule.max_ohms == null, have };
    if (rule.min_ohms != null && r < rule.min_ohms) return { ok: false, have };
    if (rule.max_ohms != null && r > rule.max_ohms) return { ok: false, have };
    return { ok: true, have };
  }
  if (rule.kind === "capacitor") {
    const have = c != null ? fmtFarads(c) : "unknown";
    if (c == null) return { ok: rule.min_farads == null && rule.max_farads == null, have };
    if (rule.min_farads != null && c < rule.min_farads) return { ok: false, have };
    if (rule.max_farads != null && c > rule.max_farads) return { ok: false, have };
    return { ok: true, have };
  }
  return { ok: true, have: "" };
}

function window(rule: BetweenRule): string {
  const parts: string[] = [];
  if (rule.min_ohms != null) parts.push(`>= ${fmtOhms(rule.min_ohms)}`);
  if (rule.max_ohms != null) parts.push(`<= ${fmtOhms(rule.max_ohms)}`);
  if (rule.min_farads != null) parts.push(`>= ${fmtFarads(rule.min_farads)}`);
  if (rule.max_farads != null) parts.push(`<= ${fmtFarads(rule.max_farads)}`);
  return parts.join(" and ");
}

export function checkBetween(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const rule of expected.between ?? []) {
    const A = net.resolveNetSet(rule.a);
    const B = net.resolveNetSet(rule.b);
    if (!A.ok) { failures.push({ check: "between", detail: `${rule.label}: ${A.error}` }); continue; }
    if (!B.ok) { failures.push({ check: "between", detail: `${rule.label}: ${B.error}` }); continue; }
    const parts = net.twoTerminals(rule.kind);
    const aName = Netlist.refName(rule.a);
    const bName = Netlist.refName(rule.b);
    // Evaluate each candidate (a, b) pair; the rule passes if any pair passes.
    let best: { matched: TwoTerminal[]; inRange: TwoTerminal[] } = { matched: [], inRange: [] };
    let passed = false;
    for (const a of A.value) for (const b of B.value) {
      if (a === b) continue;
      const matched = parts.filter((t) => bridges(t, a, b));
      const inRange = matched.filter((t) => valueOk(rule, t).ok);
      const ok = rule.count != null ? inRange.length === rule.count && matched.length === rule.count : inRange.length >= 1;
      if (ok) { passed = true; break; }
      if (matched.length > best.matched.length || inRange.length > best.inRange.length) best = { matched, inRange };
    }
    if (passed) continue;
    if (best.matched.length === 0) {
      const reversed = rule.kind === "led" || rule.kind === "diode"
        ? parts.filter((t) => A.value.some((a) => B.value.some((b) => t.aNets.includes(b) && t.bNets.includes(a))))
        : [];
      const hint = reversed.length ? ` (${reversed.map((t) => t.comp.name).join(", ")} is reversed: anode must face ${aName})` : "";
      failures.push({ check: "between", detail: `${rule.label}: no ${rule.kind} between ${aName} and ${bName}${hint}` });
    } else if (best.inRange.length === 0) {
      const have = best.matched.map((t) => `${t.comp.name}=${valueOk(rule, t).have}`).join(", ");
      failures.push({ check: "between", detail: `${rule.label}: ${rule.kind} between ${aName} and ${bName} is ${have}, outside ${window(rule)}` });
    } else {
      failures.push({ check: "between", detail: `${rule.label}: expected exactly ${rule.count} ${rule.kind}(s) between ${aName} and ${bName}, found ${best.matched.length} (${best.matched.map((t) => t.comp.name).join(", ")})` });
    }
  }
  return failures;
}
