// Client-side view of the deliverables API. Small, typed, and the single place
// that knows the URL shape — so moving to live generation touches one file.

export interface DeliverableFile {
  path: string;
  category:
    | "fabrication"
    | "assembly"
    | "cad"
    | "3d"
    | "image"
    | "data"
    | "simulation"
    | "report";
  description: string;
  mime: string;
  bytes: number;
}

export interface DeliverableManifest {
  name: string;
  spec_id?: string;
  generated_at: string;
  metrics: {
    width_mm: number;
    height_mm: number;
    area_mm2: number;
    layers: number;
    components: number;
    unique_parts: number;
    nets: number;
    traces: number;
    vias: number;
    trace_mm: number;
  };
  files: DeliverableFile[];
  /** Views the worker built for this board (from Atlas): no download bundle. */
  live?: boolean;
}

export const manifestUrl = (boardId: string) =>
  `/api/boards/${boardId}/deliverables`;

export const fileUrl = (boardId: string, filePath: string) =>
  `/api/boards/${boardId}/deliverables?file=${encodeURIComponent(filePath)}`;

/** Zips are pre-built next to the bundle; the board house wants the flat one. */
export const zipUrl = (boardId: string, only?: "gerbers") =>
  only === "gerbers"
    ? `/deliverables/${boardId}-gerbers.zip`
    : `/deliverables/${boardId}-deliverables.zip`;

export interface BomRow {
  designator: string;
  comment: string;
  value: string;
  footprint: string;
}

/**
 * The BOM is small, machine-written CSV from our own exporter — quoted fields,
 * no embedded newlines — so a full CSV parser would be more risk than value.
 */
export function parseBom(csv: string): BomRow[] {
  const lines = csv.trim().split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const cells = line
      .split(",")
      .map((c) => c.trim().replace(/^"([\s\S]*)"$/, "$1"));
    return {
      designator: cells[0] ?? "",
      comment: cells[1] ?? "",
      value: cells[2] ?? "",
      footprint: cells[3] ?? "",
    };
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
