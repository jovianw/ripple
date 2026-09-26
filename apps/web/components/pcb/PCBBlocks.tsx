"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Line, RoundedBox } from "@react-three/drei";
import type { Group } from "three";

import type { PCBBlock } from "@/lib/blocks";
import type { PCBComponent, PCBState } from "@/lib/types";
import { PCBComponentMesh } from "./PCBComponentMesh";
import { PCBTraceLine } from "./PCBTraceLine";
import { BOARD_THICKNESS, BOARD_TOP, COLORS } from "./pcbScene.shared";

const MARGIN = 0.45; // keep in step with TILE_PAD in lib/blocks.ts
const FAIL = "#ff5f5f";
const PASS = "#43d17a";

/**
 * A failed board, pulled apart into the blocks it can be rebuilt as. Each block
 * slides out from where it sat, on its own tile, so the seams between blocks
 * (the wiring that crossed them, which is hidden here) read as the places the
 * design splits.
 */
export function PCBBlocks({
  pcb,
  blocks,
  selectedId,
  onSelect,
}: {
  pcb: PCBState;
  blocks: PCBBlock[];
  selectedId: string | null;
  onSelect: (component: PCBComponent | null) => void;
}) {
  const byId = useMemo(() => new Map(pcb.components.map((c) => [c.id, c])), [pcb.components]);
  const traceById = useMemo(() => new Map(pcb.traces.map((t) => [t.id, t])), [pcb.traces]);

  return (
    <>
      {blocks.map((block, i) => (
        <SlidingBlock key={block.id} block={block} index={i} total={blocks.length}>
          <BlockTile block={block} index={i} />
          {block.traceIds.map((id) => {
            const trace = traceById.get(id);
            return trace ? <PCBTraceLine key={id} trace={trace} /> : null;
          })}
          {block.componentIds.map((id) => {
            const component = byId.get(id);
            return component ? (
              <PCBComponentMesh
                key={id}
                component={component}
                selected={id === selectedId}
                flashToken={-1}
                onSelect={onSelect}
              />
            ) : null;
          })}
        </SlidingBlock>
      ))}
    </>
  );
}

function SlidingBlock({
  block,
  index,
  total,
  children,
}: {
  block: PCBBlock;
  index: number;
  total: number;
  children: React.ReactNode;
}) {
  const group = useRef<Group>(null);
  // Blocks leave one after another, failing ones first.
  const startAt = useRef<number | null>(null);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    startAt.current ??= state.clock.elapsedTime + index * 0.12;
    if (state.clock.elapsedTime < startAt.current) return;
    const k = 1 - Math.exp(-delta * (total > 1 ? 3.2 : 6));
    g.position.x += (block.offset.x - g.position.x) * k;
    g.position.z += (-block.offset.y - g.position.z) * k;
  });

  return <group ref={group}>{children}</group>;
}

function BlockTile({ block, index }: { block: PCBBlock; index: number }) {
  const w = block.size.width + MARGIN * 2;
  const h = block.size.height + MARGIN * 2;
  const { x, y } = block.center;
  const color = block.failing ? FAIL : PASS;

  const outline = useMemo<[number, number, number][]>(() => {
    const top = BOARD_TOP + 0.006;
    const hw = w / 2 - 0.08;
    const hh = h / 2 - 0.08;
    return [
      [x - hw, top, -y - hh],
      [x + hw, top, -y - hh],
      [x + hw, top, -y + hh],
      [x - hw, top, -y + hh],
      [x - hw, top, -y - hh],
    ];
  }, [x, y, w, h]);

  return (
    <group>
      <RoundedBox
        args={[w, BOARD_THICKNESS, h]}
        position={[x, 0, -y]}
        radius={0.1}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={COLORS.substrate} roughness={0.66} metalness={0.1} />
      </RoundedBox>
      <Line points={outline} color={color} lineWidth={block.failing ? 3 : 2.2} />
      <Html
        // Front edge, toward the camera: clear of the part labels floating above.
        position={[x, BOARD_TOP + 0.05, -y + h / 2 + 0.28]}
        center
        distanceFactor={13}
        zIndexRange={[30, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="flex items-center gap-1.5 whitespace-nowrap rounded-sm border bg-[#222733]/90 px-2 py-1 font-mono text-[11px] leading-none text-white/90"
          style={{ borderColor: color }}
        >
          <span style={{ color }}>{block.failing ? "✕" : "✓"}</span>
          <span className="text-white/60">{index + 1}</span>
          <span>{block.title}</span>
        </div>
      </Html>
    </group>
  );
}
