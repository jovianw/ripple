// Analog rules computed from part values: resistive divider and RC low-pass.
import type { CheckFailure } from "@ripple/types"
import type { ExpectedChecks } from "../expected.ts"
import { Netlist, bridges, fmtFarads, fmtOhms, parallel } from "../netlist.ts"

function resistanceBetween(net: Netlist, a: string, b: string): { ohms?: number; names: string[] } {
  const rs = net.twoTerminals("resistor").filter((t) => bridges(t, a, b) && t.comp.resistance != null);
  return { ohms: parallel(rs.map((t) => t.comp.resistance!)), names: rs.map((t) => t.comp.name) };
}

function capacitanceBetween(net: Netlist, a: string, b: string): { farads?: number; names: string[] } {
  const cs = net.twoTerminals("capacitor").filter((t) => bridges(t, a, b) && t.comp.capacitance != null);
  return { farads: cs.length ? cs.reduce((s, t) => s + t.comp.capacitance!, 0) : undefined, names: cs.map((t) => t.comp.name) };
}

export function checkDivider(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const rule of expected.divider ?? []) {
    const top = net.resolveNet(rule.top);
    const bottom = net.resolveNet(rule.bottom);
    const out = net.resolveNet(rule.out);
    const bad = [top, bottom, out].find((r) => !r.ok);
    if (bad && !bad.ok) { failures.push({ check: "divider", detail: `${rule.label}: ${bad.error}` }); continue; }
    if (!top.ok || !bottom.ok || !out.ok) continue;
    const ra = resistanceBetween(net, top.value, out.value);
    const rb = resistanceBetween(net, out.value, bottom.value);
    if (ra.ohms == null) { failures.push({ check: "divider", detail: `${rule.label}: no resistor between ${Netlist.refName(rule.top)} and ${Netlist.refName(rule.out)}` }); continue; }
    if (rb.ohms == null) { failures.push({ check: "divider", detail: `${rule.label}: no resistor between ${Netlist.refName(rule.out)} and ${Netlist.refName(rule.bottom)}` }); continue; }
    const vout = rule.vin * rb.ohms / (ra.ohms + rb.ohms);
    const total = ra.ohms + rb.ohms;
    const desc = `${ra.names.join("||")}=${fmtOhms(ra.ohms)} over ${rb.names.join("||")}=${fmtOhms(rb.ohms)}`;
    if (vout < rule.vout_min || vout > rule.vout_max) failures.push({ check: "divider", detail: `${rule.label}: ${desc} gives ${vout.toFixed(2)}V at ${rule.vin}V in, outside ${rule.vout_min}-${rule.vout_max}V` });
    if (rule.min_total_ohms != null && total < rule.min_total_ohms) failures.push({ check: "divider", detail: `${rule.label}: total ${fmtOhms(total)} ohm is below ${fmtOhms(rule.min_total_ohms)}` });
  }
  return failures;
}

export function checkRcLowpass(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const rule of expected.rc_lowpass ?? []) {
    const IN = net.resolveNetSet(rule.in);
    const out = net.resolveNet(rule.out);
    const gnd = net.resolveNet(rule.gnd);
    if (!IN.ok) { failures.push({ check: "rc_lowpass", detail: `${rule.label}: ${IN.error}` }); continue; }
    if (!out.ok) { failures.push({ check: "rc_lowpass", detail: `${rule.label}: ${out.error}` }); continue; }
    if (!gnd.ok) { failures.push({ check: "rc_lowpass", detail: `${rule.label}: ${gnd.error}` }); continue; }
    const c = capacitanceBetween(net, out.value, gnd.value);
    if (c.farads == null) { failures.push({ check: "rc_lowpass", detail: `${rule.label}: no capacitor from ${Netlist.refName(rule.out)} to ${Netlist.refName(rule.gnd)}` }); continue; }
    let r: { ohms?: number; names: string[] } = { names: [] };
    for (const k of IN.value) { if (k === out.value) continue; r = resistanceBetween(net, k, out.value); if (r.ohms != null) break; }
    if (r.ohms == null) { failures.push({ check: "rc_lowpass", detail: `${rule.label}: no series resistor between ${Netlist.refName(rule.in)} and ${Netlist.refName(rule.out)}` }); continue; }
    const tau = r.ohms * c.farads;
    const fc = 1 / (2 * Math.PI * tau);
    const desc = `${r.names.join("||")}=${fmtOhms(r.ohms)} ohm, ${c.names.join("+")}=${fmtFarads(c.farads)}: tau=${(tau * 1e3).toFixed(2)}ms, cutoff=${fc.toFixed(0)}Hz`;
    const tauBad = (rule.min_tau_s != null && tau < rule.min_tau_s) || (rule.max_tau_s != null && tau > rule.max_tau_s);
    const fcBad = (rule.min_cutoff_hz != null && fc < rule.min_cutoff_hz) || (rule.max_cutoff_hz != null && fc > rule.max_cutoff_hz);
    if (tauBad) failures.push({ check: "rc_lowpass", detail: `${rule.label}: ${desc}; tau outside ${(rule.min_tau_s ?? 0) * 1e3}-${(rule.max_tau_s ?? Infinity) * 1e3}ms` });
    if (fcBad) failures.push({ check: "rc_lowpass", detail: `${rule.label}: ${desc}; cutoff outside ${rule.min_cutoff_hz ?? 0}-${rule.max_cutoff_hz ?? Infinity}Hz` });
  }
  return failures;
}
