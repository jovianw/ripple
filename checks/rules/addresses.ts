// Distinct I2C addresses: base (7-bit, low bits zero) + address-pin bits (MSB first) must differ.
import type { CheckFailure } from "@ripple/types"
import type { ExpectedChecks } from "../expected.ts"
import { Netlist } from "../netlist.ts"

export function checkDistinctAddresses(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const rule of expected.distinct_addresses ?? []) {
    const high = net.resolveNet(rule.high);
    const low = net.resolveNet(rule.low);
    if (!high.ok) { failures.push({ check: "addresses", detail: `${rule.label}: ${high.error}` }); continue; }
    if (!low.ok) { failures.push({ check: "addresses", detail: `${rule.label}: ${low.error}` }); continue; }
    const seen = new Map<number, string>();
    let bad = false;
    for (const dev of rule.devices) {
      let bits = 0;
      for (const pinName of dev.pins) {
        const pin = net.resolvePin(`${dev.chip}.${pinName}`);
        if (!pin.ok) { failures.push({ check: "addresses", detail: `${rule.label}: ${pin.error}` }); bad = true; break; }
        const k = pin.value.net;
        const bit = k === high.value ? 1 : k === low.value ? 0 : undefined;
        if (bit == null) { failures.push({ check: "addresses", detail: `${rule.label}: ${dev.chip}.${pinName} is not tied to ${Netlist.refName(rule.high)} or ${Netlist.refName(rule.low)}` }); bad = true; break; }
        bits = (bits << 1) | bit;
      }
      if (bad) break;
      const addr = dev.base + bits;
      const other = seen.get(addr);
      if (other) failures.push({ check: "addresses", detail: `${rule.label}: ${dev.chip} and ${other} both answer at 0x${addr.toString(16)}` });
      seen.set(addr, dev.chip);
    }
  }
  return failures;
}
