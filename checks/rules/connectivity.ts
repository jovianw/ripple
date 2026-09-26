// Connectivity: every required net exists, and nets that must stay apart do.
import type { CheckFailure } from "@board-forge/types"
import type { ExpectedChecks } from "../expected.ts"
import type { Netlist } from "../netlist.ts"

export function checkConnectivity(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const req of expected.nets ?? []) {
    if (!req.pins || req.pins.length === 0) {
      if (!net.namedNets.has(req.name)) failures.push({ check: "connectivity", detail: `required net ${req.name} not found (named nets: ${[...net.namedNets.keys()].join(", ") || "none"})` });
      continue;
    }
    const groups = new Map<string, string[]>(); // key -> pin refs
    const unconnected: string[] = [];
    let bad = false;
    for (const ref of req.pins) {
      const r = net.resolvePin(ref);
      if (!r.ok) { failures.push({ check: "connectivity", detail: `net ${req.name}: ${r.error}` }); bad = true; continue; }
      if (!r.value.net) { unconnected.push(ref); continue; }
      const g = groups.get(r.value.net) ?? [];
      g.push(ref);
      groups.set(r.value.net, g);
    }
    if (bad) continue;
    if (unconnected.length) failures.push({ check: "connectivity", detail: `net ${req.name}: ${unconnected.join(", ")} not connected to anything` });
    if (groups.size > 1) {
      const parts = [...groups.values()].map((g) => `{${g.join(", ")}}`).join(" and ");
      failures.push({ check: "connectivity", detail: `net ${req.name}: ${parts} are not connected to each other` });
    }
  }
  for (const [a, b] of expected.separate ?? []) {
    const ra = net.resolveNet(a);
    const rb = net.resolveNet(b);
    if (!ra.ok) { failures.push({ check: "separate", detail: ra.error }); continue; }
    if (!rb.ok) { failures.push({ check: "separate", detail: rb.error }); continue; }
    if (ra.value === rb.value) failures.push({ check: "separate", detail: `${a} and ${b} are shorted together (same net)` });
  }
  return failures;
}
