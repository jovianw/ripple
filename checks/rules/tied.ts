// Tied pins: a pin must sit on one of the listed nets, never float.
import type { CheckFailure } from "@ripple/types"
import type { ExpectedChecks } from "../expected.ts"
import { Netlist } from "../netlist.ts"

export function checkTied(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const rule of expected.tied ?? []) {
    const pin = net.resolvePin(rule.pin);
    if (!pin.ok) { failures.push({ check: "tied", detail: pin.error }); continue; }
    const allowed = rule.to.map((r) => Netlist.refName(r)).join(", ");
    if (!pin.value.net) { failures.push({ check: "tied", detail: `${rule.pin} is floating; tie it to one of ${allowed}` }); continue; }
    let ok = false;
    for (const to of rule.to) {
      const r = net.resolveNetSet(to);
      if (r.ok && r.value.includes(pin.value.net)) { ok = true; break; }
    }
    if (!ok) failures.push({ check: "tied", detail: `${rule.pin} is on ${net.describeNet(pin.value.net)}, not one of ${allowed}` });
  }
  return failures;
}
