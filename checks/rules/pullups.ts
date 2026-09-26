// I2C pull-ups: each SDA/SCL line has a resistor between it and VCC.
import type { CheckFailure } from "@board-forge/types"
import type { ExpectedChecks } from "../expected.ts"
import type { Netlist } from "../netlist.ts"

export function checkPullups(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const bus of expected.i2c ?? []) {
    const vcc = net.resolveNet(bus.vcc);
    if (!vcc.ok) { failures.push({ check: "pullups", detail: vcc.error }); continue; }
    for (const [label, ref] of [["SDA", bus.sda], ["SCL", bus.scl]] as const) {
      const line = net.resolveNet(ref);
      if (!line.ok) { failures.push({ check: "pullups", detail: `${label} (${ref}): ${line.error}` }); continue; }
      const candidates = net.componentsOfType("simple_resistor").filter((r) => {
        const keys = r.ports.map((p) => p.net);
        return keys.includes(line.value) && keys.includes(vcc.value);
      });
      if (candidates.length === 0) {
        failures.push({ check: "pullups", detail: `${label} (${ref}) has no pull-up resistor to ${bus.vcc}` });
        continue;
      }
      const inRange = candidates.filter((r) => {
        const ohms = r.resistance ?? NaN;
        if (bus.min_ohms != null && !(ohms >= bus.min_ohms)) return false;
        if (bus.max_ohms != null && !(ohms <= bus.max_ohms)) return false;
        return true;
      });
      if (inRange.length === 0) {
        const have = candidates.map((r) => `${r.name}=${r.display_resistance ?? r.resistance}`).join(", ");
        const want = [bus.min_ohms != null ? `>= ${bus.min_ohms}` : null, bus.max_ohms != null ? `<= ${bus.max_ohms}` : null].filter(Boolean).join(" and ");
        failures.push({ check: "pullups", detail: `${label} (${ref}) pull-up ${have} is outside ${want} ohms` });
      }
    }
  }
  return failures;
}
