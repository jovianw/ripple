"use client";

import { useMemo } from "react";
import { Line, RoundedBox } from "@react-three/drei";

import { BOARD_THICKNESS, BOARD_TOP, COLORS } from "./pcbScene.shared";

/**
 * The substrate: a thin rounded slab plus a faint silkscreen border, which
 * gives the eye something to read scale and orientation against.
 */
export function PCBBoard({ width, height }: { width: number; height: number }) {
  const border = useMemo<[number, number, number][]>(() => {
    const inset = 0.3;
    const w = width / 2 - inset;
    const h = height / 2 - inset;
    const y = BOARD_TOP + 0.005;
    return [
      [-w, y, -h],
      [w, y, -h],
      [w, y, h],
      [-w, y, h],
      [-w, y, -h],
    ];
  }, [width, height]);

  return (
    <group>
      <RoundedBox
        args={[width, BOARD_THICKNESS, height]}
        radius={0.12}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={COLORS.substrate}
          roughness={0.72}
          metalness={0.08}
        />
      </RoundedBox>

      <Line
        points={border}
        color={COLORS.silk}
        lineWidth={1}
        transparent
        opacity={0.3}
      />
    </group>
  );
}
