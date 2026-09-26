// Circuit-level rules: resistors between nets, tied pins, LEDs and their series resistors,
// dividers, RC time constants, and switches. All work on the netlist, not on component names.
import type { CheckFailure } from "@ripple/types"
import type { ExpectedChecks } from "../expected.ts"
import type { ComponentInfo, Netlist } from "../netlist.ts"

const fmtOhms = (r?: number) => (r == null ? "?" : r >= 1000 ? `${+(r / 1000).toFixed(2)}k` : `${r}`)
const inRange = (v: number | undefined, min?: number, max?: number) =>
  v != null && (min == null || v >= min) && (max == null || v <= max)
const range = (min?: number, max?: number, unit = "") =>
  [min != null ? `>= ${min}${unit}` : null, max != null ? `<= ${max}${unit}` : null].filter(Boolean).join(" and ")

export function checkResistors(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = []
  for (const rule of expected.resistors ?? []) {
    const a = net.resolveNet(rule.a)
    const b = net.resolveNet(rule.b)
    if (!a.ok || !b.ok) { failures.push({ check: "resistors", detail: `${rule.label}: ${(!a.ok ? a : b as any).error}` }); continue }
    // Candidate paths: one resistor a-b, or (series_ok) two resistors a-x-b.
    const paths: { names: string; ohms?: number }[] = net.between("simple_resistor", a.value, b.value)
      .map((r) => ({ names: `${r.name}=${fmtOhms(r.resistance)}`, ohms: r.resistance }))
    if (rule.series_ok) {
      for (const r1 of net.componentsOfType("simple_resistor")) {
        const mid = net.otherSide(r1, a.value)
        if (!mid || mid === b.value) continue
        for (const r2 of net.between("simple_resistor", mid, b.value)) {
          if (r2 === r1) continue
          paths.push({ names: `${r1.name}=${fmtOhms(r1.resistance)} + ${r2.name}=${fmtOhms(r2.resistance)}`, ohms: (r1.resistance ?? NaN) + (r2.resistance ?? NaN) })
        }
      }
    }
    if (paths.length === 0) { failures.push({ check: "resistors", detail: `${rule.label}: no resistor between ${rule.a} and ${rule.b}` }); continue }
    if (!paths.some((p) => inRange(p.ohms, rule.min_ohms, rule.max_ohms))) {
      failures.push({ check: "resistors", detail: `${rule.label}: ${paths.map((p) => p.names).join(", ")} outside ${range(rule.min_ohms, rule.max_ohms, " ohms")}` })
    }
  }
  return failures
}

export function checkTied(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = []
  for (const rule of expected.tied ?? []) {
    const pins = net.resolvePins(rule.pin)
    if (!pins.ok) {
      if (!(rule.optional && /pin .* not found/.test(pins.error))) failures.push({ check: "tied", detail: `${rule.label}: ${pins.error}` })
      continue
    }
    const targets = rule.one_of.map((r) => net.resolveNet(r)).filter((r) => r.ok).map((r) => (r as { value: string }).value)
    for (const p of pins.value) {
      if (!p.net) { failures.push({ check: "tied", detail: `${rule.label}: ${p.ref} is floating (tie it to ${rule.one_of.join(" or ")})` }); continue }
      if (!targets.includes(p.net)) failures.push({ check: "tied", detail: `${rule.label}: ${p.ref} is on ${net.describeNet(p.net)}, expected ${rule.one_of.join(" or ")}` })
    }
  }
  return failures
}

// ---- LEDs ----

interface LedChain {
  led: ComponentInfo
  /** Net at the far end of the anode side (through the series resistor if there is one). */
  anodeEnd?: string
  cathodeEnd?: string
  resistor?: ComponentInfo
  /** Resistor also feeds another LED. */
  shared: boolean
}

/** A resistor is "in series" with an LED pin when that pin's net holds only the pin and the resistor. */
function seriesResistor(net: Netlist, led: ComponentInfo, key: string | undefined): ComponentInfo | undefined {
  if (!key) return undefined
  const comps = net.componentsOnNet(key).filter((c) => c !== led)
  if (comps.length !== 1 || comps[0].ftype !== "simple_resistor") return undefined
  return comps[0]
}

export function ledChains(net: Netlist): LedChain[] {
  return net.componentsOfType("simple_led").map((led) => {
    const anode = net.pinOn(led, "anode")?.net
    const cathode = net.pinOn(led, "cathode")?.net
    const rA = seriesResistor(net, led, anode)
    const rC = rA ? undefined : seriesResistor(net, led, cathode)
    const resistor = rA ?? rC
    const chain: LedChain = {
      led,
      anodeEnd: rA ? net.otherSide(rA, anode!) : anode,
      cathodeEnd: rC ? net.otherSide(rC, cathode!) : cathode,
      resistor,
      shared: false,
    }
    if (!resistor && anode && cathode) {
      // Shared resistor: an LED pin sits on a net with a resistor and other LEDs.
      const r = [anode, cathode].flatMap((k) => net.componentsOnNet(k)).find((c) => c.ftype === "simple_resistor")
      if (r) { chain.resistor = r; chain.shared = true }
    }
    return chain
  })
}

export function checkLeds(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = []
  const rule = expected.leds
  const chains = ledChains(net)
  if (rule) {
    if (rule.min_count != null && chains.length < rule.min_count) failures.push({ check: "leds", detail: `expected at least ${rule.min_count} LED(s), found ${chains.length}` })
    for (const c of chains) {
      if (!c.resistor) failures.push({ check: "leds", detail: `${c.led.name} has no series resistor` })
      else if (c.shared) failures.push({ check: "leds", detail: `${c.led.name} shares resistor ${c.resistor.name} with another LED; each LED needs its own` })
      else if (!inRange(c.resistor.resistance, rule.min_ohms, rule.max_ohms)) {
        failures.push({ check: "leds", detail: `${c.led.name} series resistor ${c.resistor.name}=${fmtOhms(c.resistor.resistance)} outside ${range(rule.min_ohms, rule.max_ohms, " ohms")}` })
      }
    }
  }
  for (const p of expected.led_paths ?? []) {
    const from = net.resolveNet(p.from)
    const to = net.resolveNet(p.to)
    if (!from.ok || !to.ok) { failures.push({ check: "leds", detail: `${p.label}: ${(!from.ok ? from : to as any).error}` }); continue }
    const good = chains.filter((c) => c.resistor && !c.shared && c.anodeEnd === from.value && c.cathodeEnd === to.value)
    const backwards = chains.filter((c) => c.anodeEnd === to.value && c.cathodeEnd === from.value)
    if (p.count != null ? good.length !== p.count : good.length === 0) {
      const why = backwards.length ? ` (${backwards.map((c) => c.led.name).join(", ")} is reversed)` : ""
      failures.push({ check: "leds", detail: `${p.label}: expected ${p.count ?? "an"} LED + series resistor from ${p.from} to ${p.to}, found ${good.length}${why}` })
    }
  }
  for (const d of expected.led_drivers ?? []) {
    let driverNets: Set<string>
    if (/^(role|part):[^.]+$/.test(d.driver)) {
      const comps = net.resolveComponents(d.driver)
      if (!comps.ok) { failures.push({ check: "leds", detail: `${d.label}: ${comps.error}` }); continue }
      // Signal pins only: skip nets that are the component's supply or ground.
      const supply = new Set(comps.value.flatMap((c) => ["VCC", "VCC2", "GND", "GND2"].map((n) => net.pinOn(c, n)?.net)).filter(Boolean) as string[])
      driverNets = new Set(comps.value.flatMap((c) => c.ports.map((p) => p.net)).filter((k): k is string => !!k && !supply.has(k)))
    } else {
      const k = net.resolveNet(d.driver)
      if (!k.ok) { failures.push({ check: "leds", detail: `${d.label}: ${k.error}` }); continue }
      driverNets = new Set([k.value])
    }
    const driven = chains.filter((c) => c.resistor && !c.shared && ((c.anodeEnd && driverNets.has(c.anodeEnd)) || (c.cathodeEnd && driverNets.has(c.cathodeEnd))))
    if (d.count != null ? driven.length !== d.count : driven.length === 0) {
      failures.push({ check: "leds", detail: `${d.label}: expected ${d.count ?? "at least one"} LED (with its own resistor) driven by ${d.driver}, found ${driven.length}` })
    }
  }
  return failures
}

// ---- Analog: dividers and RC ----

export function checkDividers(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = []
  for (const d of expected.dividers ?? []) {
    const [i, o, g] = [d.input, d.output, d.ground].map((r) => net.resolveNet(r))
    const bad = [i, o, g].find((r) => !r.ok) as { error: string } | undefined
    if (bad) { failures.push({ check: "divider", detail: `${d.label}: ${bad.error}` }); continue }
    const top = net.between("simple_resistor", (i as any).value, (o as any).value)
    const bottom = net.between("simple_resistor", (o as any).value, (g as any).value)
    if (!top.length || !bottom.length) {
      failures.push({ check: "divider", detail: `${d.label}: needs a resistor from ${d.input} to ${d.output} and one from ${d.output} to ${d.ground}` })
      continue
    }
    const par = (rs: ComponentInfo[]) => 1 / rs.reduce((s, r) => s + 1 / (r.resistance ?? Infinity), 0)
    const rt = par(top), rb = par(bottom)
    const ratio = rb / (rt + rb)
    if (!(ratio >= d.min_ratio && ratio <= d.max_ratio)) {
      failures.push({ check: "divider", detail: `${d.label}: ratio ${ratio.toFixed(3)} (${fmtOhms(rt)} over ${fmtOhms(rb)}) outside ${d.min_ratio}-${d.max_ratio}` })
    }
    if (d.min_total_ohms != null && rt + rb < d.min_total_ohms) {
      failures.push({ check: "divider", detail: `${d.label}: total ${fmtOhms(rt + rb)} ohms draws too much current (min ${fmtOhms(d.min_total_ohms)})` })
    }
  }
  return failures
}

export function checkRc(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = []
  for (const rule of expected.rc ?? []) {
    const node = net.resolveNet(rule.node)
    const gnd = net.resolveNet(rule.ground)
    if (!node.ok || !gnd.ok) { failures.push({ check: "rc", detail: `${rule.label}: ${(!node.ok ? node : gnd as any).error}` }); continue }
    const caps = net.between("simple_capacitor", node.value, gnd.value)
    let rs: ComponentInfo[]
    if (rule.r_from) {
      const from = net.resolveNet(rule.r_from)
      if (!from.ok) { failures.push({ check: "rc", detail: `${rule.label}: ${from.error}` }); continue }
      rs = net.between("simple_resistor", from.value, node.value)
    } else {
      rs = net.componentsOfType("simple_resistor").filter((r) => r.ports.some((p) => p.net === node.value) && !r.ports.some((p) => p.net === gnd.value))
    }
    if (!caps.length || !rs.length) {
      failures.push({ check: "rc", detail: `${rule.label}: needs a resistor into ${rule.node}${rule.r_from ? ` from ${rule.r_from}` : ""} and a capacitor from ${rule.node} to ${rule.ground}` })
      continue
    }
    const taus = rs.flatMap((r) => caps.map((c) => ({ r, c, tau: (r.resistance ?? 0) * (c.capacitance ?? 0) })))
    if (!taus.some((t) => t.tau >= rule.min_tau_s && t.tau <= rule.max_tau_s)) {
      const have = taus.map((t) => `${t.r.name}*${t.c.name}=${(t.tau * 1000).toFixed(3)}ms`).join(", ")
      failures.push({ check: "rc", detail: `${rule.label}: time constant ${have} outside ${rule.min_tau_s * 1000}-${rule.max_tau_s * 1000}ms` })
    }
  }
  return failures
}

export function checkSwitches(net: Netlist, expected: ExpectedChecks): CheckFailure[] {
  const failures: CheckFailure[] = []
  for (const rule of expected.switches ?? []) {
    const a = net.resolveNet(rule.a)
    const b = net.resolveNet(rule.b)
    if (!a.ok || !b.ok) { failures.push({ check: "switch", detail: `${rule.label}: ${(!a.ok ? a : b as any).error}` }); continue }
    const reachesA = (k: string | undefined) =>
      k === a.value || (rule.via_resistor_ok && !!k && net.between("simple_resistor", k, a.value).length > 0)
    const ok = net.componentsOfType("simple_push_button").some((s) => {
      const keys = s.ports.map((p) => p.net)
      return keys.includes(b.value) && keys.some((k) => k !== b.value && reachesA(k))
    })
    if (!ok) failures.push({ check: "switch", detail: `${rule.label}: no pushbutton switching ${rule.a} to ${rule.b}` })
  }
  return failures
}
