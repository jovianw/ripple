// Decoupling: a capacitor from each chip's power pin to ground, within max_mm of the pin's pad.
import type { CheckFailure } from "@ripple/types"
import type { ExpectedChecks } from "../expected.ts"
import { distanceMm, type Netlist } from "../netlist.ts"

const DEFAULT_MAX_MM = 3;

function fmtMm(mm: number): string {
  return `${Math.round(mm * 10) / 10}mm`;
}

export function checkDecoupling(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const rule of expected.decoupling ?? []) {
    const label = `${rule.chip} ${rule.power_pin}`;
    const maxMm = rule.max_mm ?? DEFAULT_MAX_MM;
    const pin = net.resolvePin(`${rule.chip}.${rule.power_pin}`);
    if (!pin.ok) { failures.push({ check: "decoupling", detail: `${label}: ${pin.error}` }); continue; }
    if (!pin.value.net) { failures.push({ check: "decoupling", detail: `${label} is not connected to anything` }); continue; }
    const powerKey = pin.value.net;

    let groundKey: string | undefined;
    if (rule.ground) {
      const g = net.resolveNet(rule.ground);
      if (!g.ok) { failures.push({ check: "decoupling", detail: `${label}: ${g.error}` }); continue; }
      groundKey = g.value;
    }
    const isGroundSide = (key: string | undefined) => {
      if (!key || key === powerKey) return false;
      if (groundKey) return key === groundKey;
      if (net.groundKeys.size) return net.groundKeys.has(key);
      return true;
    };

    // Caps with one pin on the power net and the other on ground.
    const caps = net.componentsOfType("simple_capacitor").flatMap((c) => {
      const powerSide = c.ports.find((p) => p.net === powerKey);
      const other = c.ports.find((p) => p !== powerSide);
      if (!powerSide || !other || !isGroundSide(other.net)) return [];
      return [{ cap: c, powerPad: powerSide }];
    });
    if (caps.length === 0) {
      failures.push({ check: "decoupling", detail: `${label} has no capacitor to ${rule.ground ?? "ground"} on its net` });
      continue;
    }
    const bigEnough = caps.filter(({ cap }) => rule.min_farads == null || (cap.capacitance ?? 0) >= rule.min_farads);
    if (bigEnough.length === 0) {
      const have = caps.map(({ cap }) => `${cap.name}=${cap.display_capacitance ?? cap.capacitance}`).join(", ");
      failures.push({ check: "decoupling", detail: `${label} capacitor ${have} is below ${rule.min_farads}F` });
      continue;
    }
    const measured = bigEnough.map((c) => ({ ...c, mm: distanceMm(pin.value, c.powerPad) }));
    const near = measured.filter((c) => c.mm != null && c.mm <= maxMm);
    if (near.length === 0) {
      const nearest = measured.filter((c) => c.mm != null).sort((a, b) => a.mm! - b.mm!)[0];
      const hint = nearest ? ` (nearest ${nearest.cap.name} at ${fmtMm(nearest.mm!)})` : " (no PCB placement found)";
      failures.push({ check: "decoupling", detail: `${label} has no cap within ${maxMm}mm${hint}` });
    }
  }
  return failures;
}
