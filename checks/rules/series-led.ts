// Series LED: an LED with its own series resistor between rail (anode side) and gnd.
import type { CheckFailure } from "@ripple/types"
import type { ExpectedChecks, SeriesLedRule } from "../expected.ts"
import { Netlist, fmtOhms, type TwoTerminal } from "../netlist.ts"

interface Found { led: TwoTerminal; resistor?: TwoTerminal; middle?: string; problem?: string }

function findLeds(net: Netlist, rule: SeriesLedRule, railKeys: string[], gnd: string): Found[] {
  const resistors = net.twoTerminals("resistor");
  const found: Found[] = [];
  for (const led of net.twoTerminals("led")) {
    const anode = led.aNets[0];
    const cathode = led.bNets[0];
    if (!anode || !cathode) continue;
    const onRail = railKeys.includes(anode);
    const onGnd = cathode === gnd;
    const reversed = railKeys.includes(cathode) || anode === gnd;
    if (!onRail && !onGnd) {
      if (reversed) found.push({ led, problem: `${led.comp.name} is reversed (anode must face ${Netlist.refName(rule.rail)})` });
      continue;
    }
    if (onRail && onGnd) { found.push({ led, problem: `${led.comp.name} has no series resistor (anode on ${Netlist.refName(rule.rail)}, cathode on ${Netlist.refName(rule.gnd)})` }); continue; }
    const middle = onRail ? cathode : anode;
    const far = onRail ? gnd : undefined;
    const resistor = resistors.find((r) =>
      onRail ? (r.aNets.includes(middle) && r.bNets.includes(far!)) || (r.bNets.includes(middle) && r.aNets.includes(far!))
              : (r.aNets.includes(middle) && r.bNets.some((k) => railKeys.includes(k))) || (r.bNets.includes(middle) && r.aNets.some((k) => railKeys.includes(k))));
    if (!resistor) {
      // An LED on gnd whose resistor goes to some other net belongs to another rail; ignore it here.
      const elsewhere = !onRail && resistors.some((r) => r.aNets.includes(middle) || r.bNets.includes(middle));
      if (!elsewhere) found.push({ led, middle, problem: `${led.comp.name} has no series resistor to ${onRail ? Netlist.refName(rule.gnd) : Netlist.refName(rule.rail)}` });
      continue;
    }
    const ohms = resistor.comp.resistance;
    if (ohms != null && ((rule.min_ohms != null && ohms < rule.min_ohms) || (rule.max_ohms != null && ohms > rule.max_ohms))) {
      const w = [rule.min_ohms != null ? `>= ${fmtOhms(rule.min_ohms)}` : "", rule.max_ohms != null ? `<= ${fmtOhms(rule.max_ohms)}` : ""].filter(Boolean).join(" and ");
      found.push({ led, resistor, middle, problem: `${led.comp.name} series resistor ${resistor.comp.name}=${fmtOhms(ohms)} ohm is outside ${w}` });
      continue;
    }
    const others = net.portsOnNet(middle).filter((p) => p.component !== led.comp.name && p.component !== resistor.comp.name);
    if (others.length) { found.push({ led, resistor, middle, problem: `${led.comp.name} shares its series resistor ${resistor.comp.name} with ${[...new Set(others.map((p) => p.component))].join(", ")}` }); continue; }
    found.push({ led, resistor, middle });
  }
  return found;
}

export function checkSeriesLed(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const rule of expected.series_led ?? []) {
    const rail = net.resolveNetSet(rule.rail);
    const gnd = net.resolveNet(rule.gnd);
    if (!rail.ok) { failures.push({ check: "series_led", detail: `${rule.label}: ${rail.error}` }); continue; }
    if (!gnd.ok) { failures.push({ check: "series_led", detail: `${rule.label}: ${gnd.error}` }); continue; }
    const railKeys = rail.value.filter((k) => k !== gnd.value);
    const found = findLeds(net, rule, railKeys, gnd.value);
    const good = found.filter((f) => !f.problem);
    const bad = found.filter((f) => f.problem);
    if (rule.count != null) {
      if (good.length !== rule.count || bad.length) {
        const why = bad.length ? bad.map((f) => f.problem).join("; ") : `found ${good.length} (${good.map((f) => f.led.comp.name).join(", ") || "none"})`;
        failures.push({ check: "series_led", detail: `${rule.label}: expected exactly ${rule.count} LED(s) from ${Netlist.refName(rule.rail)} to ${Netlist.refName(rule.gnd)}: ${why}` });
      }
      continue;
    }
    if (good.length === 0) {
      const why = bad.length ? bad.map((f) => f.problem).join("; ") : `no LED between ${Netlist.refName(rule.rail)} and ${Netlist.refName(rule.gnd)}`;
      failures.push({ check: "series_led", detail: `${rule.label}: ${why}` });
    }
  }
  return failures;
}
