// Board deliverables: everything a finished board ships with, built from its Circuit JSON.
// Owner: Marcos. Pure functions (no DB, no model); the worker, scripts and the web app can all call them.
//
//   fabrication/  Gerber layers + Excellon drill        -> upload to a board house
//   assembly/     BOM (with part numbers), pick-and-place, assembly drawing
//   kicad/        .kicad_pro / .kicad_sch / .kicad_pcb  -> open and edit in KiCad
//   3d/           .glb model
//   images/       PCB, schematic and assembly views (SVG + PNG)
//   netlist.csv   every net and the pins on it
//   simulation/   SPICE netlist of the passive network
//   design/       Circuit JSON and, if given, the tscircuit source
//   report.md / report.json   spec, check results, metrics, BOM summary, file index
//   manifest.json  machine-readable file list for the front end
import type { AnyCircuitElement } from "circuit-json"
import type { RunResult } from "@ripple/types"
import { convertCircuitJsonToGerberFiles } from "circuit-json-to-gerber"
import { convertCircuitJsonToBomRows, convertBomRowsToCsv } from "circuit-json-to-bom-csv"

type BomRow = Awaited<ReturnType<typeof convertCircuitJsonToBomRows>>[number]
import { convertCircuitJsonToPickAndPlaceCsv } from "circuit-json-to-pnp-csv"
import { CircuitJsonToKicadPcbConverter, CircuitJsonToKicadProConverter, CircuitJsonToKicadSchConverter } from "circuit-json-to-kicad"
import { convertCircuitJsonToAssemblySvg, convertCircuitJsonToPcbSvg, convertCircuitJsonToSchematicSvg } from "circuit-to-svg"
import { convertCircuitJsonToGltf } from "circuit-json-to-gltf"
import { circuitJsonToSpice, convertSpiceNetlistToString } from "circuit-json-to-spice"
import { Resvg } from "@resvg/resvg-js"
import { zipSync, strToU8 } from "fflate"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type Category = "fabrication" | "assembly" | "cad" | "3d" | "image" | "data" | "simulation" | "report"

export interface DeliverableFile {
  path: string
  category: Category
  description: string
  /** MIME type, for the front end's download links and previews. */
  mime: string
  bytes: number
}

export interface BoardMetrics {
  width_mm: number
  height_mm: number
  area_mm2: number
  layers: number
  components: number
  unique_parts: number
  nets: number
  traces: number
  vias: number
  trace_mm: number
}

export interface Deliverables {
  /** Path inside the package -> contents. */
  files: Record<string, string | Uint8Array>
  manifest: { name: string; spec_id?: string; generated_at: string; metrics: BoardMetrics; files: DeliverableFile[] }
  /** Files that could not be produced, with the reason; everything else is still valid. */
  skipped: { path: string; reason: string }[]
}

export interface DeliverablesInput {
  circuitJson: AnyCircuitElement[]
  /** Short file-safe name, e.g. "finale". */
  name: string
  specId?: string
  specText?: string
  /** tscircuit source that produced the board, if available. */
  source?: string
  /** Hidden-check result for the board, if it was graded. */
  result?: RunResult
  /** Harness config version that produced the board. */
  harnessVersion?: number
}

type El = AnyCircuitElement & Record<string, any>

// ---- metrics and netlist ----

export function boardMetrics(json: AnyCircuitElement[]): BoardMetrics {
  const els = json as El[]
  const board = els.find((e) => e.type === "pcb_board")
  const comps = els.filter((e) => e.type === "source_component")
  const traces = els.filter((e) => e.type === "pcb_trace")
  let trace_mm = 0
  for (const t of traces) {
    const pts = ((t.route ?? []) as any[]).filter((p) => typeof p.x === "number") as { x: number; y: number }[]
    for (let i = 1; i < pts.length; i++) trace_mm += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  const width = board?.width ?? 0
  const height = board?.height ?? 0
  const partKey = (c: El) => c.manufacturer_part_number ?? `${c.ftype}:${c.resistance ?? c.capacitance ?? c.color ?? ""}`
  return {
    width_mm: width,
    height_mm: height,
    area_mm2: Math.round(width * height * 10) / 10,
    layers: board?.num_layers ?? 2,
    components: comps.length,
    unique_parts: new Set(comps.map(partKey)).size,
    nets: netlistRows(json).length,
    traces: traces.length,
    vias: els.filter((e) => e.type === "pcb_via").length,
    trace_mm: Math.round(trace_mm * 10) / 10,
  }
}

/** One row per electrical net: its name (if named) and every component pin on it. */
export function netlistRows(json: AnyCircuitElement[]): { net: string; pins: string[] }[] {
  const els = json as El[]
  const comps = els.filter((e) => e.type === "source_component")
  const compName = new Map(comps.map((c) => [c.source_component_id, c.name]))
  // Resistors and capacitors have no polarity: call their pins pin1/pin2, not anode/cathode.
  const passive = new Set(comps.filter((c) => c.ftype === "simple_resistor" || c.ftype === "simple_capacitor").map((c) => c.source_component_id))
  const byKey = new Map<string, string[]>()
  for (const p of els.filter((e) => e.type === "source_port" && e.subcircuit_connectivity_map_key)) {
    const label = passive.has(p.source_component_id) ? p.name : (p.port_hints ?? []).find((h: string) => !/^(pin)?\d+$/.test(h)) ?? p.name
    const list = byKey.get(p.subcircuit_connectivity_map_key) ?? []
    list.push(`${compName.get(p.source_component_id) ?? "?"}.${label}`)
    byKey.set(p.subcircuit_connectivity_map_key, list)
  }
  const names = new Map(els.filter((e) => e.type === "source_net" && e.subcircuit_connectivity_map_key).map((n) => [n.subcircuit_connectivity_map_key, n.name]))
  let anon = 0
  return [...byKey.entries()]
    .filter(([, pins]) => pins.length > 1)
    .map(([key, pins]) => ({ net: names.get(key) ?? `N${++anon}`, pins: pins.sort() }))
    .sort((a, b) => a.net.localeCompare(b.net, undefined, { numeric: true }))
}

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`

// ---- report ----

function reportMarkdown(input: DeliverablesInput, metrics: BoardMetrics, bom: BomRow[] | undefined, files: DeliverableFile[]): string {
  const r = input.result
  const lines = [
    `# ${input.name}`,
    "",
    `Generated by Ripple${input.harnessVersion != null ? ` (harness v${input.harnessVersion})` : ""} on ${new Date().toISOString()}.`,
    "",
  ]
  if (input.specText) lines.push("## Spec", "", `> ${input.specText}`, "")
  if (r) {
    lines.push("## Checks", "", r.passed ? "**Passed** every hidden check with 0 design-rule errors." : `**Failed** ${r.failures.length} check(s):`, "")
    for (const f of r.failures) lines.push(`- \`${f.check}\`: ${f.detail}`)
    if (r.failures.length) lines.push("")
  }
  lines.push(
    "## Board", "",
    "| Metric | Value |", "|---|---|",
    `| Size | ${metrics.width_mm} × ${metrics.height_mm} mm (${metrics.area_mm2} mm²) |`,
    `| Layers | ${metrics.layers} |`,
    `| Components | ${metrics.components} (${metrics.unique_parts} unique) |`,
    `| Nets | ${metrics.nets} |`,
    `| Traces / vias | ${metrics.traces} / ${metrics.vias} |`,
    `| Trace length | ${metrics.trace_mm} mm |`,
    "",
  )
  if (bom) {
    const groups = new Map<string, { part: string; footprint: string; des: string[] }>()
    for (const r of bom) {
      const part = r.comment || r.value || "(no part number)"
      const key = `${part}|${r.footprint}`
      const g = groups.get(key) ?? { part, footprint: r.footprint, des: [] }
      g.des.push(r.designator)
      groups.set(key, g)
    }
    lines.push("## Bill of materials", "", "| Qty | Part | Footprint | Designators |", "|---|---|---|---|")
    for (const g of groups.values()) lines.push(`| ${g.des.length} | ${g.part} | ${g.footprint} | ${g.des.join(", ")} |`)
    lines.push("")
  }
  lines.push("## Files", "", "| File | What it is |", "|---|---|")
  for (const f of files) lines.push(`| \`${f.path}\` | ${f.description} |`)
  lines.push(
    "",
    "## Limits",
    "",
    "The checks prove the board meets its spec and common design rules, not that it works on the bench.",
    "Check footprints and pinouts (especially the USB-C receptacle) against datasheets before ordering.",
    "",
  )
  return lines.join("\n")
}

// ---- build ----

const MIME: Record<string, string> = {
  gbr: "application/vnd.gerber", drl: "text/plain", csv: "text/csv", svg: "image/svg+xml", png: "image/png",
  glb: "model/gltf-binary", json: "application/json", md: "text/markdown", tsx: "text/plain", cir: "text/plain",
  kicad_pcb: "text/plain", kicad_sch: "text/plain", kicad_pro: "application/json",
}

// Chips carry their manufacturer part number (parts/whitelist.json) so they can be sourced.
const bomRows = (json: AnyCircuitElement[]) =>
  convertCircuitJsonToBomRows({
    circuitJson: json,
    resolvePart: async ({ source_component }) => {
      const mpn = (source_component as { manufacturer_part_number?: string }).manufacturer_part_number
      return mpn ? { manufacturer_mpn_pairs: [{ manufacturer: "", mpn }] } : null
    },
  })

const netlistCsv = (json: AnyCircuitElement[]) =>
  ["net,pins", ...netlistRows(json).map((r) => `${csvCell(r.net)},${csvCell(r.pins.join(" "))}`)].join("\n") + "\n"

/** What the web app shows for any board: text files only, small enough to store on the board's Atlas record. */
export interface BoardViews {
  manifest: Deliverables["manifest"]
  files: { path: string; content: string }[]
}

/**
 * The web app's view of a board: PCB and schematic images, BOM and netlist, with a manifest in the same shape as
 * buildDeliverables'. No Gerbers, KiCad, 3D or PNGs: those stay with `npm run export`. A failing view is left out.
 */
export async function buildBoardViews(json: AnyCircuitElement[], name: string, specId?: string): Promise<BoardViews> {
  const made: { path: string; category: Category; description: string; content: string }[] = []
  const add = async (path: string, category: Category, description: string, make: () => string | Promise<string>) => {
    try { made.push({ path, category, description, content: await make() }) } catch { /* left out of the manifest */ }
  }
  await add("images/pcb.svg", "image", "PCB layout, top view", () => convertCircuitJsonToPcbSvg(json))
  await add("images/schematic.svg", "image", "Schematic", () => convertCircuitJsonToSchematicSvg(json))
  await add("assembly/bom.csv", "assembly", "Bill of materials with manufacturer part numbers", async () => convertBomRowsToCsv(await bomRows(json)))
  await add("netlist.csv", "data", "Every net and the component pins on it", () => netlistCsv(json))
  return {
    manifest: {
      name, spec_id: specId, generated_at: new Date().toISOString(), metrics: boardMetrics(json),
      files: made.map(({ path, category, description, content }) => ({
        path, category, description, mime: MIME[path.split(".").pop()!] ?? "text/plain", bytes: Buffer.byteLength(content),
      })),
    },
    files: made.map(({ path, content }) => ({ path, content })),
  }
}

function png(svg: string, width = 1600): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "#ffffff" }).render().asPng()
}

/** Builds every deliverable for a board. One failing exporter never stops the others. */
export async function buildDeliverables(input: DeliverablesInput): Promise<Deliverables> {
  const { circuitJson: json, name } = input
  const files: Record<string, string | Uint8Array> = {}
  const described: Omit<DeliverableFile, "bytes" | "mime">[] = []
  const skipped: Deliverables["skipped"] = []
  const add = (path: string, category: Category, description: string, data: string | Uint8Array) => {
    files[path] = data
    described.push({ path, category, description })
  }
  const attempt = async (path: string, make: () => unknown | Promise<unknown>) => {
    try { await make() } catch (e) { skipped.push({ path, reason: (e as Error).message.slice(0, 200) }) }
  }

  await attempt("fabrication/", () => {
    for (const [file, text] of Object.entries(convertCircuitJsonToGerberFiles(json, { flip_y_axis: false }))) {
      const drill = file.endsWith(".drl")
      add(`fabrication/${name}-${file}`, "fabrication", drill ? `Excellon drill file (${file.includes("npth") ? "non-plated" : "plated"} holes)` : `Gerber layer ${file.replace(/\.gbr$/, "")}`, text)
    }
  })

  let bom: BomRow[] | undefined
  await attempt("assembly/bom.csv", async () => {
    bom = await bomRows(json)
    add("assembly/bom.csv", "assembly", "Bill of materials with manufacturer part numbers", convertBomRowsToCsv(bom))
  })
  await attempt("assembly/pnp.csv", () => add("assembly/pnp.csv", "assembly", "Pick-and-place: component positions and rotations", convertCircuitJsonToPickAndPlaceCsv(json)))
  await attempt("assembly/assembly.svg", () => add("assembly/assembly.svg", "assembly", "Assembly drawing: where each part goes", convertCircuitJsonToAssemblySvg(json)))

  await attempt("kicad/", () => {
    const sch = new CircuitJsonToKicadSchConverter(json as any)
    sch.runUntilFinished()
    const pcb = new CircuitJsonToKicadPcbConverter(json as any)
    pcb.runUntilFinished()
    const pro = new CircuitJsonToKicadProConverter(json as any, {
      projectName: name, schematicFilename: `${name}.kicad_sch`, pcbFilename: `${name}.kicad_pcb`, schematicSheetPlan: sch.schematicSheetPlan,
    })
    pro.runUntilFinished()
    add(`kicad/${name}.kicad_pro`, "cad", "KiCad project: open this in KiCad", pro.getOutputString())
    add(`kicad/${name}.kicad_sch`, "cad", "KiCad schematic", sch.getOutputString())
    add(`kicad/${name}.kicad_pcb`, "cad", "KiCad PCB layout", pcb.getOutputString())
  })

  await attempt(`3d/${name}.glb`, async () => {
    const glb = await convertCircuitJsonToGltf(json as any, { format: "glb", includeModels: false })
    add(`3d/${name}.glb`, "3d", "3D model of the assembled board (glTF binary)", new Uint8Array(glb as ArrayBuffer))
  })

  await attempt("images/", () => {
    const pcbSvg = convertCircuitJsonToPcbSvg(json)
    add("images/pcb.svg", "image", "PCB layout, top view", pcbSvg)
    add("images/pcb.png", "image", "PCB layout, top view (PNG)", png(pcbSvg))
  })
  await attempt("images/schematic", () => {
    const schSvg = convertCircuitJsonToSchematicSvg(json)
    add("images/schematic.svg", "image", "Schematic", schSvg)
    add("images/schematic.png", "image", "Schematic (PNG)", png(schSvg))
  })

  add("netlist.csv", "data", "Every net and the component pins on it", netlistCsv(json))
  await attempt(`simulation/${name}.cir`, () =>
    add(`simulation/${name}.cir`, "simulation", "SPICE netlist of the passive network (resistors, capacitors, LEDs)", convertSpiceNetlistToString(circuitJsonToSpice(json))))

  add("design/circuit.json", "data", "Full design in tscircuit Circuit JSON", JSON.stringify(json, null, 2))
  if (input.source) add(`design/${name}.tsx`, "data", "tscircuit source that produced the board", input.source)

  const metrics = boardMetrics(json)
  const bytes = (d: string | Uint8Array) => (typeof d === "string" ? Buffer.byteLength(d) : d.byteLength)
  const withMeta = (d: Omit<DeliverableFile, "bytes" | "mime">): DeliverableFile => ({
    ...d, mime: MIME[d.path.split(".").pop()!] ?? "application/octet-stream", bytes: bytes(files[d.path]),
  })
  const reportFiles = [
    { path: "report.md", category: "report" as const, description: "Design report: spec, check results, metrics, BOM, file index" },
    { path: "report.json", category: "report" as const, description: "Same report, machine-readable" },
    { path: "manifest.json", category: "report" as const, description: "File list with categories and MIME types" },
  ]
  const listed = [...described.map(withMeta), ...reportFiles.map((f) => ({ ...f, mime: MIME[f.path.split(".").pop()!], bytes: 0 }))]
  files["report.md"] = reportMarkdown(input, metrics, bom, listed)
  files["report.json"] = JSON.stringify({
    name, spec_id: input.specId, spec: input.specText, harness_version: input.harnessVersion,
    passed: input.result?.passed, failures: input.result?.failures ?? [], metrics, skipped,
  }, null, 2)
  const manifest: Deliverables["manifest"] = {
    name, spec_id: input.specId, generated_at: new Date().toISOString(), metrics,
    files: listed.map((f) => (f.path === "manifest.json" ? f : { ...f, bytes: bytes(files[f.path]) })),
  }
  files["manifest.json"] = JSON.stringify(manifest, null, 2)
  return { files, manifest, skipped }
}

/** One zip with everything under a top-level folder named after the board. */
export function zipDeliverables(d: Deliverables, name: string): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(d.files).map(([p, data]) => [`${name}/${p}`, typeof data === "string" ? strToU8(data) : data])), { level: 6 })
}

/** Just the fabrication files (Gerbers + drill), zipped flat, the way board houses want them. */
export function zipFabrication(d: Deliverables): Uint8Array {
  const fab = Object.entries(d.files).filter(([p]) => p.startsWith("fabrication/"))
  return zipSync(Object.fromEntries(fab.map(([p, data]) => [p.slice("fabrication/".length), typeof data === "string" ? strToU8(data) : data])), { level: 6 })
}

/** Writes <outDir>/<name>/ (every file), <name>-deliverables.zip and <name>-gerbers.zip. Returns the paths written. */
export function writeDeliverables(d: Deliverables, name: string, outDir = "out"): { dir: string; zip: string; gerbers: string } {
  const dir = `${outDir}/${name}`
  rmSync(dir, { recursive: true, force: true })
  for (const [path, data] of Object.entries(d.files)) {
    mkdirSync(dirname(`${dir}/${path}`), { recursive: true })
    writeFileSync(`${dir}/${path}`, data)
  }
  const zip = `${outDir}/${name}-deliverables.zip`
  const gerbers = `${outDir}/${name}-gerbers.zip`
  writeFileSync(zip, zipDeliverables(d, name))
  writeFileSync(gerbers, zipFabrication(d))
  return { dir, zip, gerbers }
}
