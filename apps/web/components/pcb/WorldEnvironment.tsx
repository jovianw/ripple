"use client";

/**
 * Surround for the board: a flat scene background. Set on the scene itself
 * rather than drawn as geometry, so three's color management renders the
 * exact sRGB value.
 */

export const WORLD_BACKGROUND = "#222733"; // rgb(34, 39, 51)

export function WorldEnvironment() {
  return <color attach="background" args={[WORLD_BACKGROUND]} />;
}
