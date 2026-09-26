"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, type Mesh, type MeshBasicMaterial } from "three";

import { BOARD_TOP, COLORS } from "./pcbScene.shared";

/**
 * Ripple's signature: change propagation.
 *
 * Every meaningful edit to the design emits one expanding ring across the board
 * plane from the part that changed — placement in the accent, a failure in red,
 * a repair in amber. It is a visualisation of "something changed here and it
 * matters", not decoration, so nothing emits on idle frames.
 */

const LIFE_MS = 700;
const MAX_RADIUS = 3.4;

export type RippleTone = "place" | "error" | "repair";

export interface RippleEvent {
  id: string;
  x: number;
  y: number;
  tone: RippleTone;
}

const TONE_COLOR: Record<RippleTone, string> = {
  place: COLORS.placing,
  error: COLORS.error,
  repair: COLORS.repairing,
};

function Ring({ event, onDone }: { event: RippleEvent; onDone: (id: string) => void }) {
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  const age = useRef(0);

  // Belt and braces: retire the ring on a timer as well as in the frame loop,
  // so a stalled renderer cannot leak rings.
  useEffect(() => {
    const t = setTimeout(() => onDone(event.id), LIFE_MS + 120);
    return () => clearTimeout(t);
  }, [event.id, onDone]);

  useFrame((_, delta) => {
    age.current += delta * 1000;
    const t = Math.min(1, age.current / LIFE_MS);

    if (mesh.current) {
      // Fast out, slow settle — reads as propagation rather than a balloon.
      const eased = 1 - Math.pow(1 - t, 2.4);
      mesh.current.scale.setScalar(0.25 + eased * MAX_RADIUS);
    }
    if (material.current) {
      material.current.opacity = (1 - t) * 0.5;
    }
  });

  return (
    <mesh
      ref={mesh}
      position={[event.x, BOARD_TOP + 0.02, -event.y]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      {/* Thin annulus: a wavefront, not a disc. */}
      <ringGeometry args={[0.86, 1, 64]} />
      <meshBasicMaterial
        ref={material}
        color={TONE_COLOR[event.tone]}
        transparent
        opacity={0.5}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

export function RippleField({ events }: { events: RippleEvent[] }) {
  const [live, setLive] = useState<RippleEvent[]>([]);
  const seen = useRef(new Set<string>());

  // Admit each event once. The parent re-sends its list on every snapshot, so
  // deduping here keeps rings from restarting on unrelated re-renders.
  useEffect(() => {
    const fresh = events.filter((e) => !seen.current.has(e.id));
    if (fresh.length === 0) return;
    fresh.forEach((e) => seen.current.add(e.id));
    setLive((prev) => [...prev, ...fresh]);
  }, [events]);

  const retire = (id: string) =>
    setLive((prev) => prev.filter((e) => e.id !== id));

  return (
    <>
      {live.map((event) => (
        <Ring key={event.id} event={event} onDone={retire} />
      ))}
    </>
  );
}
