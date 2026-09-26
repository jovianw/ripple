// Board quality comparisons. Owner: Jovian. Pure functions shared by the gate and the ablation.
// Quality is only ever compared between boards of the same spec: absolute numbers depend on what the spec asks
// for, and density can be inflated with bigger footprints, so neither is compared across specs.

/** The per-board numbers quality is judged on (a subset of tools/metrics.ts CircuitMetrics). Lower is better for each. */
export interface BoardQuality {
  area_mm2: number;
  detour: number;
  vias: number;
  parts: number;
  bom_usd: number;
}

/** Everything tools/metrics.ts measures on a compiled board (stored on each run as `quality`). */
export interface RunQuality extends BoardQuality {
  /** Component footprint area ÷ board area (0..1). Display only: bigger footprints inflate it. */
  density: number;
  trace_mm: number;
  /** Point-to-point connections the board has to make: Σ over nets of (ports − 1). */
  connections: number;
}

/**
 * How much better `b` is than `a`, two boards for the same spec: the geometric mean of a/b over area, detour,
 * vias + 1 (so via-free boards compare), parts and BOM cost. Above 1 means b is better; 1.1 is "10% better".
 */
export function boardRatio(a: BoardQuality, b: BoardQuality): number {
  const pairs: [string, number, number][] = [
    ["area_mm2", a.area_mm2, b.area_mm2],
    ["detour", a.detour, b.detour],
    ["vias + 1", a.vias + 1, b.vias + 1],
    ["parts", a.parts, b.parts],
    ["bom_usd", a.bom_usd, b.bom_usd],
  ];
  for (const [name, x, y] of pairs)
    if (!(x > 0 && y > 0)) throw new Error(`boardRatio: ${name} must be positive (got ${x} and ${y})`);
  return Math.exp(pairs.reduce((s, [, x, y]) => s + Math.log(x / y), 0) / pairs.length);
}

export function median(xs: number[]): number {
  if (!xs.length) throw new Error("median of no values");
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface QualityComparison {
  /** Median over shared specs of boardRatio(parent, candidate); above 1 means the candidate builds better boards. Null when no spec passed under both. */
  ratio: number | null;
  /** Specs that passed under both versions. */
  shared: number;
}

/** Candidate vs parent board quality, per spec (spec id -> that version's passing board), median over the specs both passed. */
export function qualityVsParent(candidate: Map<string, BoardQuality>, parent: Map<string, BoardQuality>): QualityComparison {
  const ratios = [...candidate].flatMap(([spec, q]) => {
    const p = parent.get(spec);
    return p ? [boardRatio(p, q)] : [];
  });
  return { ratio: ratios.length ? median(ratios) : null, shared: ratios.length };
}
