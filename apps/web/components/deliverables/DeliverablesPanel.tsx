"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fileUrl,
  formatBytes,
  manifestUrl,
  parseBom,
  zipUrl,
  type BomRow,
  type DeliverableManifest,
} from "@/lib/deliverables";

type Tab = "pcb" | "schematic" | "bom" | "files";

const TABS: { id: Tab; label: string }[] = [
  { id: "pcb", label: "PCB" },
  { id: "schematic", label: "Schematic" },
  { id: "bom", label: "Bill of materials" },
  { id: "files", label: "Files" },
];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-[11px] text-faint">{label} </span>
      <span className="font-mono text-[12px] text-dim [font-variant-numeric:tabular-nums]">
        {value}
      </span>
    </span>
  );
}

/**
 * What the run actually produced: a manufacturable package, not a picture.
 * Opens over the world as the closing beat of a build.
 */
export function DeliverablesPanel({
  boardId,
  onClose,
}: {
  boardId: string;
  onClose: () => void;
}) {
  const [manifest, setManifest] = useState<DeliverableManifest | null>(null);
  const [bom, setBom] = useState<BomRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pcb");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(manifestUrl(boardId));
        if (!res.ok) throw new Error(`manifest ${res.status}`);
        const data = (await res.json()) as DeliverableManifest;
        if (cancelled) return;
        setManifest(data);

        const bomEntry = data.files.find((f) => f.path.endsWith("bom.csv"));
        if (!bomEntry) return;
        const csv = await fetch(fileUrl(boardId, bomEntry.path)).then((r) => r.text());
        if (!cancelled) setBom(parseBom(csv));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [boardId]);

  // Esc closes, as anywhere else that takes over the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const byCategory = useMemo(() => {
    if (!manifest) return [];
    const groups = new Map<string, typeof manifest.files>();
    for (const f of manifest.files) {
      const list = groups.get(f.category) ?? [];
      list.push(f);
      groups.set(f.category, list);
    }
    return [...groups.entries()];
  }, [manifest]);

  const m = manifest?.metrics;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-void/96 backdrop-blur-sm">
      <div className="flex shrink-0 items-baseline justify-between px-6 pt-5">
        <div>
          <div className="text-[18px] font-medium text-ink">Deliverables</div>
          <div className="mt-1 text-[12px] text-faint">
            {manifest ? (
              <>
                <span className="font-mono text-dim">{manifest.name}</span>
                {manifest.spec_id ? ` · ${manifest.spec_id}` : null}
                {` · ${manifest.files.length} files`}
              </>
            ) : (
              "Loading…"
            )}
          </div>
        </div>

        <div className="flex items-center gap-5">
          <a
            href={zipUrl(boardId, "gerbers")}
            className="text-[13px] text-accent hover:text-ink"
            download
          >
            Download Gerbers →
          </a>
          <a
            href={zipUrl(boardId)}
            className="text-[13px] text-dim hover:text-ink"
            download
          >
            Download all →
          </a>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-ghost hover:text-ink"
          >
            Close ✕
          </button>
        </div>
      </div>

      {m ? (
        <div className="mt-3 flex shrink-0 flex-wrap gap-x-5 gap-y-1 px-6">
          <Stat label="size" value={`${m.width_mm}×${m.height_mm}mm`} />
          <Stat label="area" value={`${m.area_mm2}mm²`} />
          <Stat label="layers" value={String(m.layers)} />
          <Stat label="parts" value={`${m.components} (${m.unique_parts} unique)`} />
          <Stat label="nets" value={String(m.nets)} />
          <Stat label="traces" value={String(m.traces)} />
          <Stat label="vias" value={String(m.vias)} />
          <Stat label="copper" value={`${m.trace_mm}mm`} />
        </div>
      ) : null}

      <nav className="mt-4 flex shrink-0 gap-5 border-b border-hair px-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b pb-2 text-[13px] transition-colors ${
              tab === t.id
                ? "border-accent text-ink"
                : "border-transparent text-faint hover:text-dim"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="slim-scroll min-h-0 flex-1 overflow-auto px-6 py-5">
        {error ? (
          <p className="text-[13px] text-bad">Could not load deliverables: {error}</p>
        ) : null}

        {manifest && (tab === "pcb" || tab === "schematic") ? (
          // The exporter's own renders — the real artwork, not a re-draw.
          <div className="flex h-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrl(
                boardId,
                tab === "pcb" ? "images/pcb.svg" : "images/schematic.svg",
              )}
              alt={tab === "pcb" ? "PCB artwork" : "Schematic"}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : null}

        {manifest && tab === "bom" ? (
          bom && bom.length > 0 ? (
            <table className="w-full max-w-2xl text-left text-[13px]">
              <thead>
                <tr className="text-[11px] text-faint">
                  <th className="pb-2 font-normal">Ref</th>
                  <th className="pb-2 font-normal">Part</th>
                  <th className="pb-2 font-normal">Value</th>
                  <th className="pb-2 font-normal">Footprint</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {bom.map((row) => (
                  <tr key={row.designator} className="border-t border-hair">
                    <td className="py-1.5 font-mono text-dim">{row.designator}</td>
                    <td className="py-1.5 text-ink">{row.comment || "—"}</td>
                    <td className="py-1.5 font-mono text-dim">{row.value || "—"}</td>
                    <td className="py-1.5 font-mono text-faint">{row.footprint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-faint">No bill of materials in this bundle.</p>
          )
        ) : null}

        {manifest && tab === "files" ? (
          <div className="space-y-5">
            {byCategory.map(([category, files]) => (
              <section key={category}>
                <h3 className="text-[11px] text-faint">{category}</h3>
                <ul className="mt-1.5">
                  {files.map((f) => (
                    <li
                      key={f.path}
                      className="flex items-baseline gap-4 border-t border-hair py-1.5"
                    >
                      <a
                        href={fileUrl(boardId, f.path)}
                        className="font-mono text-[12px] text-dim hover:text-accent"
                        download
                      >
                        {f.path}
                      </a>
                      <span className="flex-1 truncate text-[12px] text-ghost">
                        {f.description}
                      </span>
                      <span className="font-mono text-[11px] text-faint [font-variant-numeric:tabular-nums]">
                        {formatBytes(f.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
