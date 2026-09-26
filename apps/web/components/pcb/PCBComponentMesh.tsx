"use client";

import { useEffect, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { Mesh, MeshStandardMaterial } from "three";

import type { PCBComponent } from "@/lib/types";
import {
  BOARD_TOP,
  COLORS,
  DEFAULT_SIZE,
  MATERIAL_BY_TYPE,
  STATUS_EMISSIVE,
} from "./pcbScene.shared";

/** How long the "being placed" drop-in takes. */
const PLACE_MS = 550;
/** How far above the board a new part starts. */
const DROP_HEIGHT = 1.4;

const LABELLED = new Set(["ic", "module", "connector", "sensor"]);

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

export function PCBComponentMesh({
  component,
  selected,
  flashToken,
  onSelect,
}: {
  component: PCBComponent;
  selected: boolean;
  /**
   * Bumped by the snapshot diff when this part *changed* (rather than being
   * added). Existing meshes never remount, so this is what re-triggers the
   * highlight when e.g. U2 flips to an error state.
   */
  flashToken: number;
  onSelect: (component: PCBComponent | null) => void;
}) {
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const elapsed = useRef(0);
  const flash = useRef(Number.POSITIVE_INFINITY);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (flashToken >= 0) flash.current = 0;
  }, [flashToken]);

  const size = { ...DEFAULT_SIZE, ...component.size };
  const depth = size.depth ?? DEFAULT_SIZE.depth;
  const restY = BOARD_TOP + depth / 2;
  const status = component.status ?? "normal";
  const finish = MATERIAL_BY_TYPE[component.type];
  const emissive = STATUS_EMISSIVE[status];

  useFrame((_, delta) => {
    if (!mesh.current) return;
    elapsed.current += delta * 1000;

    // Drop-in: every mesh animates on mount, which is exactly when the diff
    // says a component was added (stable ids keep existing meshes mounted).
    const t = Math.min(1, elapsed.current / PLACE_MS);
    const eased = easeOut(t);
    mesh.current.position.y = restY + DROP_HEIGHT * (1 - eased);
    const scale = 0.8 + 0.2 * eased;
    mesh.current.scale.setScalar(scale);

    if (!material.current) return;

    flash.current += delta * 1000;
    const flashIntensity = Math.max(0, 1 - flash.current / 450) * 1.3;

    // Placement flash fades out; error/repair states pulse until cleared.
    let intensity = Math.max((1 - eased) * 1.6, flashIntensity);
    if (status === "error" || status === "repairing") {
      intensity = Math.max(
        intensity,
        0.45 + 0.35 * Math.sin(elapsed.current / 160),
      );
    } else if (status === "success") {
      intensity = Math.max(intensity, 0.18);
    } else if (status === "new") {
      intensity = Math.max(intensity, 0.3);
    }
    if (hovered || selected) intensity = Math.max(intensity, 0.55);
    material.current.emissiveIntensity = intensity;
  });

  const highlight = hovered || selected;
  // Passives stay unlabelled until pointed at, so the board isn't a wall of text.
  const showLabel = LABELLED.has(component.type) || hovered || selected;
  const annotation =
    status === "error"
      ? (component.note ?? "Design rule violation")
      : status === "repairing"
        ? (component.note ?? "Repairing")
        : null;

  return (
    <group position={[component.position.x, 0, -component.position.y]}>
      {/* Pad footprint under the package. */}
      <mesh position={[0, BOARD_TOP + 0.006, 0]} rotation={[0, component.rotation ?? 0, 0]}>
        <boxGeometry args={[size.width * 1.12, 0.012, size.height * 1.12]} />
        <meshStandardMaterial color={COLORS.pad} metalness={0.85} roughness={0.35} />
      </mesh>

      <mesh
        ref={mesh}
        position={[0, restY, 0]}
        rotation={[0, component.rotation ?? 0, 0]}
        castShadow
        receiveShadow
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(component);
        }}
      >
        <boxGeometry args={[size.width, depth, size.height]} />
        <meshStandardMaterial
          ref={material}
          color={finish.color}
          metalness={finish.metalness}
          roughness={finish.roughness}
          emissive={emissive ?? (highlight ? COLORS.placing : "#000000")}
          emissiveIntensity={0}
        />
      </mesh>

      {showLabel ? (
        <Html
          position={[0, restY + depth / 2 + 0.46, 0]}
          center
          distanceFactor={13}
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div className="whitespace-nowrap text-center font-mono leading-none">
            {/* Reference designator carries the weight; the part name is
                supporting text, as on a real assembly drawing. */}
            <div
              className={`text-[13px] font-semibold tracking-tight ${
                status === "error"
                  ? "text-[#ff6b6b]"
                  : status === "repairing"
                    ? "text-[#ffc154]"
                    : "text-white/90"
              }`}
            >
              {component.label}
            </div>
            <div className="mt-[3px] text-[8px] uppercase tracking-[0.16em] text-white/40">
              {component.shortName ?? component.part ?? component.type}
            </div>
          </div>
        </Html>
      ) : null}

      {/* Fault annotation, anchored to the part it is about. This is the link
          between the critic's sentence and the object on the board. */}
      {annotation ? (
        <Html
          position={[0, restY + depth / 2 + 1.02, 0]}
          center
          distanceFactor={13}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-1 font-mono text-[10px] backdrop-blur-sm ${
              status === "error"
                ? "border-[#ff4d4d]/50 bg-[#2a0f0f]/85 text-[#ff8a8a]"
                : "border-[#ffb020]/50 bg-[#2a1e08]/85 text-[#ffc154]"
            }`}
          >
            <span aria-hidden>{status === "error" ? "⚠" : "↻"}</span>
            <span>{annotation}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}
