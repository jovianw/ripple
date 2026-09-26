"use client";

import { Grid } from "@react-three/drei";

/**
 * CAD reference plane. Sits below the board so the board reads as hovering in
 * a workspace, and fades out well before the horizon so it never competes with
 * the copper.
 */
export function WorldGrid() {
  return (
    <Grid
      position={[0, -2.2, 0]}
      args={[80, 80]}
      infiniteGrid
      cellSize={1}
      cellThickness={0.5}
      cellColor="#1b2530"
      sectionSize={5}
      sectionThickness={0.8}
      sectionColor="#24323f"
      fadeDistance={36}
      fadeStrength={2.2}
      fadeFrom={0}
    />
  );
}
