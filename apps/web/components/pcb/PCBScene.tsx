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


const HOME_POS = new Vector3(0, 9.5, 10);
const HOME_TARGET = new Vector3(0, 0, 0);

/**
 * Eases the camera toward a part under inspection and back again. Deliberately
 * small: it biases attention toward the fault, it does not fly around. Skipped
 * entirely once the viewer has taken the camera themselves.
 */
function CameraRig({
  focus,
  enabled,
  controls,
}: {
  focus: { x: number; y: number } | null;
  enabled: boolean;
  controls: React.RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  const wantPos = useRef(new Vector3());
  const wantTarget = useRef(new Vector3());

  useFrame((_, delta) => {
    if (!enabled) return;

    if (focus) {
      // Sit off to one side of the part rather than directly over it, so the
      // annotation above it stays readable.
      wantTarget.current.set(focus.x * 0.75, 0, -focus.y * 0.75);
      wantPos.current.set(focus.x * 0.5, 7.2, -focus.y + 7.4);
    } else {
      wantTarget.current.copy(HOME_TARGET);
      wantPos.current.copy(HOME_POS);
    }

    // Frame-rate independent ease, ~600ms to settle.
    const k = 1 - Math.exp(-delta * 4.5);
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
  /** Suppresses idle rotation while the build is running. */
  isRunning: boolean;
  selectedId: string | null;
  /** Ids the snapshot diff reported as changed, and the version they changed at. */
  changedIds: ReadonlySet<string>;
  snapshotVersion: number;
  /** Part the camera should bias toward — the current fault, if any. */
  focusId: string | null;
  onSelect: (component: PCBComponent | null) => void;
}

export function PCBScene({
  pcb,
  isRunning,
  selectedId,
  changedIds,
  snapshotVersion,
  focusId,
  onSelect,
}: PCBSceneProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const [userMoved, setUserMoved] = useState(false);

  // Idle drift stops for good once the viewer takes the camera themselves.
  const idle = !isRunning && !userMoved;

  const focus = useMemo(() => {
    if (!focusId) return null;
    const part = pcb.components.find((c) => c.id === focusId);
    return part ? part.position : null;
  }, [focusId, pcb.components]);

  return (
    <Canvas
      shadows
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 2]}
      camera={{ position: [0, 9.5, 10], fov: 40, near: 0.1, far: 100 }}
      onPointerMissed={() => onSelect(null)}
    >
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-8, 6, -6]} intensity={0.45} color="#7fb3ff" />

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
        position={[0, -0.16, 0]}
        opacity={0.5}
        scale={22}
        blur={2.4}
        far={6}
      />

      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={6}
        maxDistance={24}
        maxPolarAngle={Math.PI / 2.15}
        minPolarAngle={0.15}
        autoRotate={idle}
        autoRotateSpeed={0.35}
        onStart={() => setUserMoved(true)}
      />

      <CameraRig focus={focus} enabled={!userMoved} controls={controls} />
    </Canvas>
  );
}
