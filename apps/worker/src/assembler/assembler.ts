// Assembler: combines finished subcircuits (tscircuit code strings, each exporting a component that
// returns a <group name=...>) into one board. Deterministic: same inputs, same code and layout.
// Groups connect only through named nets (net.V3V3, net.GND, net.SDA...). See README.md.
import { clearLabels } from "../tools/placement.js";
import type { AnyCircuitElement } from "circuit-json";
import type { RunResult } from "@ripple/types";

export interface Subcircuit {
  /** Slot name, used for the wrapper group and error messages. */
  name: string;
  /** Self-contained tscircuit TSX with one named export that returns a <group name=...>. */
  code: string;
  /** Component to place; defaults to the first `export const|function` in the code. */
  exportName?: string;
}

export interface AssembleOptions {
  /** Grade the result against this spec's hidden checks (checks/index.ts). */
  specId?: string;
  /** Clearance between group bounding boxes, mm. Default 3. */
  gapMm?: number;
  /** Clearance between the outermost groups and the board edge, mm. Default 3. */
  marginMm?: number;
  /** Target row width for shelf packing, mm. Default: derived from the total area. */
  rowWidthMm?: number;
}

export interface Placement {
  name: string;
  exportName: string;
  /** Wrapper group position on the board, mm. */
  pcbX: number;
  pcbY: number;
  /** Axis-aligned bounding box of the group's parts on the board, mm. */
  box: Box;
}

export interface Box { minX: number; minY: number; maxX: number; maxY: number }

export interface AssembleResult {
  /** Single-file tscircuit source for the whole board (subcircuits inlined, default export = board). */
  code: string;
  circuitJson: AnyCircuitElement[];
  board: { widthMm: number; heightMm: number };
  layout: Placement[];
  /** Present when options.specId was given. */
  result?: RunResult;
}

/** The subset of @tscircuit/eval's CircuitRunner we use. The module is loaded by name at runtime so
 *  tscircuit's shipped TypeScript sources stay out of the worker's NodeNext build. */
interface RunnerLike {
  setPlatformConfigProperty(property: string, value: unknown): Promise<void>;
  executeWithFsMap(opts: { fsMap: Record<string, string>; mainComponentPath?: string }): Promise<void>;
  renderUntilSettled(): Promise<void>;
  getCircuitJson(): Promise<AnyCircuitElement[]>;
  kill(): Promise<void>;
}
const EVAL_MODULE = "@tscircuit/eval";
let runnerCtor: Promise<new () => RunnerLike> | undefined;
function loadRunner(): Promise<new () => RunnerLike> {
  runnerCtor ??= import(EVAL_MODULE).then((m: { CircuitRunner: new () => RunnerLike }) => m.CircuitRunner);
  return runnerCtor;
}

const MEASURE_BOARD_MM = 400;
const measureCache = new Map<string, { box: Box }>();

/** Runs tscircuit code in-process with supplier part lookup off (no network, no JLCPCB polarity surprises). */
export async function evaluateCode(code: string): Promise<AnyCircuitElement[]> {
  const CircuitRunner = await loadRunner();
  const runner = new CircuitRunner();
  await runner.setPlatformConfigProperty("partsEngineDisabled", true);
  await runner.executeWithFsMap({ fsMap: { "main.tsx": code }, mainComponentPath: "main.tsx" });
  await runner.renderUntilSettled();
  const json = await runner.getCircuitJson();
  await runner.kill().catch(() => undefined);
  // Part-name labels moved off other parts and pads (silkscreen only; nothing else changes).
  return clearLabels(json);
}

export function findExportName(sub: Subcircuit): string {
  if (sub.exportName) return sub.exportName;
  const m = sub.code.match(/export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/);
  if (!m) throw new Error(`subcircuit "${sub.name}": no named export found (expected \`export const Name = () => <group name=...>\`)`);
  return m[1];
}

function validate(sub: Subcircuit): void {
  if (!/<group\b/.test(sub.code)) throw new Error(`subcircuit "${sub.name}": component must return a <group name=...>`);
  if (/<board\b/.test(sub.code)) throw new Error(`subcircuit "${sub.name}": must not contain a <board>; the assembler makes the board`);
  if (/^\s*import\s/m.test(sub.code)) throw new Error(`subcircuit "${sub.name}": must be self-contained (no import statements)`);
}

/** Axis-aligned extent of every placed part and pad in the Circuit JSON. */
export function partsBox(json: AnyCircuitElement[]): Box {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number, w: number, h: number) => {
    box.minX = Math.min(box.minX, x - w / 2); box.maxX = Math.max(box.maxX, x + w / 2);
    box.minY = Math.min(box.minY, y - h / 2); box.maxY = Math.max(box.maxY, y + h / 2);
  };
  for (const e of json as any[]) {
    if (e.type === "pcb_component" && e.center) add(e.center.x, e.center.y, e.width ?? 0, e.height ?? 0);
    else if (e.type === "pcb_smtpad" && e.x != null) {
      const w = e.width ?? (e.radius != null ? e.radius * 2 : 0);
      const h = e.height ?? (e.radius != null ? e.radius * 2 : 0);
      add(e.x, e.y, w, h);
    }
    else if ((e.type === "pcb_plated_hole" || e.type === "pcb_hole") && e.x != null) {
      const d = e.outer_diameter ?? e.rect_pad_width ?? e.hole_diameter ?? 0;
      const dh = e.outer_diameter ?? e.rect_pad_height ?? e.hole_diameter ?? 0;
      add(e.x, e.y, d, dh);
    }
  }
  if (!Number.isFinite(box.minX)) throw new Error("no placed parts found in subcircuit");
  return box;
}

const wrapperName = (name: string) => `slot_${name.replace(/[^A-Za-z0-9_]/g, "_")}`;

/** Renders one subcircuit alone inside a wrapper group at the origin and returns its parts' bounding box. */
export async function measureSubcircuit(sub: Subcircuit): Promise<Box> {
  const exportName = findExportName(sub);
  const key = `${exportName}\n${sub.code}`;
  const cached = measureCache.get(key);
  if (cached) return cached.box;
  const code = `${sub.code}\nexport default () => (<board width="${MEASURE_BOARD_MM}mm" height="${MEASURE_BOARD_MM}mm" routingDisabled><group name="${wrapperName(sub.name)}" pcbX={0} pcbY={0}><${exportName} /></group></board>)\n`;
  const json = await evaluateCode(code);
  const errors = (json as any[]).filter((e) => e.type.endsWith("_error") && !/routing|trace/.test(e.type));
  if (errors.length) throw new Error(`subcircuit "${sub.name}" does not render: ${errors.map((e) => e.message ?? e.type).join("; ")}`);
  const box = partsBox(json);
  measureCache.set(key, { box });
  return box;
}

/** Shelf-packs boxes (each relative to its own origin) into rows; returns each box's target center. */
export function packBoxes(boxes: { name: string; box: Box }[], gapMm: number, rowWidthMm?: number): Map<string, { cx: number; cy: number }> {
  const sized = boxes.map((b) => ({ ...b, w: b.box.maxX - b.box.minX, h: b.box.maxY - b.box.minY }));
  const area = sized.reduce((s, b) => s + (b.w + gapMm) * (b.h + gapMm), 0);
  const rowWidth = rowWidthMm ?? Math.max(Math.sqrt(area) * 1.25, ...sized.map((b) => b.w));
  // Deterministic order: tallest first, then name.
  const order = [...sized].sort((a, b) => b.h - a.h || a.name.localeCompare(b.name));
  const out = new Map<string, { cx: number; cy: number }>();
  let x = 0, y = 0, rowH = 0;
  for (const b of order) {
    if (x > 0 && x + b.w > rowWidth) { x = 0; y -= rowH + gapMm; rowH = 0; }
    out.set(b.name, { cx: x + b.w / 2, cy: y - b.h / 2 });
    x += b.w + gapMm;
    rowH = Math.max(rowH, b.h);
  }
  return out;
}

function round(n: number): number { return Math.round(n * 100) / 100; }

export async function assemble(subcircuits: Subcircuit[], options: AssembleOptions = {}): Promise<AssembleResult> {
  if (subcircuits.length === 0) throw new Error("assemble: no subcircuits given");
  const names = new Set<string>();
  for (const s of subcircuits) {
    if (names.has(s.name)) throw new Error(`assemble: duplicate subcircuit name "${s.name}"`);
    names.add(s.name);
    validate(s);
  }
  const gap = options.gapMm ?? 3;
  const margin = options.marginMm ?? 3;

  const measured: { sub: Subcircuit; exportName: string; box: Box }[] = [];
  for (const sub of subcircuits) measured.push({ sub, exportName: findExportName(sub), box: await measureSubcircuit(sub) });

  const centers = packBoxes(measured.map((m) => ({ name: m.sub.name, box: m.box })), gap, options.rowWidthMm);
  // Shift everything so the whole layout is centred on the board origin.
  const all: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const placed = measured.map((m) => {
    const c = centers.get(m.sub.name)!;
    const w = m.box.maxX - m.box.minX, h = m.box.maxY - m.box.minY;
    const box: Box = { minX: c.cx - w / 2, maxX: c.cx + w / 2, minY: c.cy - h / 2, maxY: c.cy + h / 2 };
    all.minX = Math.min(all.minX, box.minX); all.maxX = Math.max(all.maxX, box.maxX);
    all.minY = Math.min(all.minY, box.minY); all.maxY = Math.max(all.maxY, box.maxY);
    return { m, box };
  });
  const dx = -(all.minX + all.maxX) / 2, dy = -(all.minY + all.maxY) / 2;
  const widthMm = Math.ceil(all.maxX - all.minX + 2 * margin);
  const heightMm = Math.ceil(all.maxY - all.minY + 2 * margin);

  const layout: Placement[] = placed.map(({ m, box }) => {
    // Measured box is relative to a wrapper at (0,0); move the wrapper so the box lands where packed.
    const measuredCx = (m.box.minX + m.box.maxX) / 2, measuredCy = (m.box.minY + m.box.maxY) / 2;
    const targetCx = (box.minX + box.maxX) / 2 + dx, targetCy = (box.minY + box.maxY) / 2 + dy;
    return {
      name: m.sub.name, exportName: m.exportName,
      pcbX: round(targetCx - measuredCx), pcbY: round(targetCy - measuredCy),
      box: { minX: round(box.minX + dx), maxX: round(box.maxX + dx), minY: round(box.minY + dy), maxY: round(box.maxY + dy) },
    };
  });

  const codeFor = (w: number, h: number) => [
    ...subcircuits.map((s) => s.code.trim()),
    "",
    `export default () => (`,
    `  <board width="${w}mm" height="${h}mm">`,
    ...layout.map((p) => `    <group name="${wrapperName(p.name)}" pcbX={${p.pcbX}} pcbY={${p.pcbY}}><${p.exportName} /></group>`),
    `  </board>`,
    `)`,
    "",
  ].join("\n");

  let board = { widthMm, heightMm };
  let code = codeFor(board.widthMm, board.heightMm);
  let circuitJson = await evaluateCode(code);
  // Parts without an explicit position can land somewhere else on the assembled board than when measured alone.
  // If anything sits inside the margin, grow the board (it stays centred) and render once more.
  const final = partsBox(circuitJson);
  const needW = Math.ceil(2 * Math.max(Math.abs(final.minX), Math.abs(final.maxX)) + 2 * margin);
  const needH = Math.ceil(2 * Math.max(Math.abs(final.minY), Math.abs(final.maxY)) + 2 * margin);
  if (needW > board.widthMm || needH > board.heightMm) {
    board = { widthMm: Math.max(needW, board.widthMm), heightMm: Math.max(needH, board.heightMm) };
    code = codeFor(board.widthMm, board.heightMm);
    circuitJson = await evaluateCode(code);
  }
  const out: AssembleResult = { code, circuitJson, board, layout };
  if (options.specId) out.result = await grade(circuitJson, options.specId);
  return out;
}

/** Grades with the hidden checker. Loaded by path at runtime so checks/ stays out of the worker's build. */
async function grade(circuitJson: AnyCircuitElement[], specId: string): Promise<RunResult> {
  const checksUrl = new URL("../../../../checks/index.ts", import.meta.url).href;
  const checks = (await import(checksUrl)) as {
    runChecks: (json: unknown, expected: unknown, meta?: { board_id?: string }) => Promise<RunResult>;
    loadExpected: (id: string) => unknown;
  };
  return checks.runChecks(circuitJson, checks.loadExpected(specId), { board_id: specId });
}
