// Board quality comparisons. Owner: Jovian. Pure functions shared by the gate and the ablation.
// Quality is only ever compared between boards of the same spec: absolute numbers depend on what the spec asks
// for, and density can be inflated with bigger footprints, so neither is compared across specs.

/** The per-board numbers quality is judged on (a subset of tools/metrics.ts CircuitMetrics). Lower is better for each. */
export interface BoardQuality {
  area_mm2: number;
  detour: number;
  vias: number;
  /** Point-to-point connections the board has to make: Σ over nets of (ports − 1). Scales the via count. */
  connections: number;
  parts: number;
  bom_usd: number;
}

/** Everything tools/metrics.ts measures on a compiled board (stored on each run as `quality`). */
export interface RunQuality extends BoardQuality {
  /** Component footprint area ÷ board area (0..1). Display only: bigger footprints inflate it. */
  density: number;
  trace_mm: number;
}

/**
 * How each measure counts in boardRatio. Area counts double: a smaller board is the main goal, and the other
 * measures move with it (a tighter board usually routes a little longer and may need a via).
 */
export const QUALITY_WEIGHTS = { area_mm2: 2, detour: 1, vias: 1, parts: 1, bom_usd: 1 } as const;

/**
 * How much better `b` is than `a`, two boards for the same spec: the weighted geometric mean of a/b over area,
 * detour, vias, parts and BOM cost (QUALITY_WEIGHTS). Vias compare as vias + connections, so one extra via on a
 * 5-connection board is a small cost, not a doubling, and via-free boards still compare. Above 1 means b is better;
 * 1.1 is "10% better".
 */
export function boardRatio(a: BoardQuality, b: BoardQuality): number {
  const pairs: [keyof typeof QUALITY_WEIGHTS, number, number][] = [
    ["area_mm2", a.area_mm2, b.area_mm2],
    ["detour", a.detour, b.detour],
    ["vias", a.vias + a.connections, b.vias + b.connections],
    ["parts", a.parts, b.parts],
    ["bom_usd", a.bom_usd, b.bom_usd],
  ];
  for (const [name, x, y] of pairs)
    if (!(x > 0 && y > 0)) throw new Error(`boardRatio: ${name} must be positive (got ${x} and ${y})`);
  const total = pairs.reduce((s, [name]) => s + QUALITY_WEIGHTS[name], 0);
  return Math.exp(pairs.reduce((s, [name, x, y]) => s + QUALITY_WEIGHTS[name] * Math.log(x / y), 0) / total);
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
