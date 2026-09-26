"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Vector3 } from "three";

import type { PCBComponent, PCBState } from "@/lib/types";
import { PCBBoard } from "./PCBBoard";
import { PCBComponentMesh } from "./PCBComponentMesh";
import { PCBTraceLine } from "./PCBTraceLine";
import { BOARD_BOTTOM } from "./pcbScene.shared";
import { WorldEnvironment } from "./WorldEnvironment";
import { WorldGrid } from "./WorldGrid";

// Framed so the board fills roughly two thirds of the frame, with enough
// height on the camera to read the board's thickness.
const HOME_POS = new Vector3(0, 11.0, 12.2);
const HOME_TARGET = new Vector3(0, 0, 0);

/**
 * Eases the camera toward a part under inspection and back again. Deliberately
 * small: it biases attention toward the fault, it does not fly around. Skipped
 * entirely once the viewer has taken the camera themselves.
 */
function CameraRig({
  focus,
  settled,
  enabled,
  controls,
}: {
  focus: { x: number; y: number } | null;
  /** On completion the camera eases back a touch, letting the board settle. */
  settled: boolean;
  enabled: boolean;
  controls: React.RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  const wantPos = useRef(new Vector3());
  const wantTarget = useRef(new Vector3());
  // Milliseconds left of the ease back home after a focus is released. The rig
  // only drives the camera while focused or returning — the rest of the time
  // OrbitControls owns it outright, otherwise the two fight over position and
  // the framing collapses.
  const returning = useRef(0);
  const hadFocus = useRef(false);

  useFrame((_, delta) => {
    if (!enabled) return;

    const focused = focus !== null;
    if (hadFocus.current && !focused) returning.current = 900;
    hadFocus.current = focused;

    if (!focused) {
      returning.current = Math.max(0, returning.current - delta * 1000);
      if (returning.current === 0) return;
    }

    if (focused) {
      wantTarget.current.set(focus.x * 0.72, 0, -focus.y * 0.72);
      wantPos.current.set(focus.x * 0.48, 7.6, -focus.y + 8.2);
    } else {
      wantTarget.current.copy(HOME_TARGET);
      wantPos.current.copy(HOME_POS);
      if (settled) wantPos.current.multiplyScalar(1.05);
    }

    const k = 1 - Math.exp(-delta * 4.2);
    camera.position.lerp(wantPos.current, k);
    const c = controls.current;
    if (c) {
      c.target.lerp(wantTarget.current, k);
      c.update();
    }
  });

  return null;
}

export interface PCBSceneProps {
  pcb: PCBState;
  isRunning: boolean;
  selectedId: string | null;
  changedIds: ReadonlySet<string>;
  snapshotVersion: number;
  focusId: string | null;
  complete: boolean;
  onSelect: (component: PCBComponent | null) => void;
}

export function PCBScene({
  pcb,
  isRunning,
  selectedId,
  changedIds,
  snapshotVersion,
  focusId,
  complete,
  onSelect,
}: PCBSceneProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const [userMoved, setUserMoved] = useState(false);

  const idle = !isRunning && !userMoved && !complete && focusId === null;

  const focus = useMemo(() => {
    if (!focusId) return null;
    const part = pcb.components.find((c) => c.id === focusId);
    return part ? part.position : null;
  }, [focusId, pcb.components]);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: HOME_POS.toArray(), fov: 38, near: 0.1, far: 200 }}
      resize={{ debounce: 0 }}
      onPointerMissed={() => onSelect(null)}
    >
      <WorldEnvironment />
      <WorldGrid />

      {/* Low ambient so the key light does the shaping and the board keeps
          its contrast against the dark surround. */}
      <ambientLight intensity={0.85} />
      <directionalLight
        position={[5.5, 11, 7]}
        intensity={2.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      {/* Cool rim from behind, to separate the board edge from the backdrop. */}
      <directionalLight position={[-7, 4.5, -8]} intensity={0.7} color="#6fb3d8" />

      <PCBBoard width={pcb.board.width} height={pcb.board.height} />

      {pcb.traces.map((trace) => (
        <PCBTraceLine key={trace.id} trace={trace} />
      ))}

      {pcb.components.map((component) => (
        <PCBComponentMesh
          key={component.id}
          component={component}
          selected={component.id === selectedId}
          flashToken={changedIds.has(component.id) ? snapshotVersion : -1}
          onSelect={onSelect}
        />
      ))}

      <ContactShadows
        position={[0, BOARD_BOTTOM - 0.008, 0]}
        opacity={0.55}
        scale={24}
        blur={2.6}
        far={7}
      />

      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={5.5}
        maxDistance={22}
        maxPolarAngle={Math.PI / 2.15}
        minPolarAngle={0.14}
        autoRotate={idle}
        autoRotateSpeed={0.3}
        onStart={() => setUserMoved(true)}
      />

      <CameraRig
        focus={focus}
        settled={complete}
        enabled={!userMoved}
        controls={controls}
      />
    </Canvas>
  );
}
