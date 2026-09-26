"use client";

import { useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import type { PCBComponent, PCBState } from "@/lib/types";
import { PCBBoard } from "./PCBBoard";
import { PCBComponentMesh } from "./PCBComponentMesh";
import { PCBTraceLine } from "./PCBTraceLine";

export interface PCBSceneProps {
  pcb: PCBState;
  /** Suppresses idle rotation while the build is running. */
  isRunning: boolean;
  selectedId: string | null;
  /** Ids the snapshot diff reported as changed, and the version they changed at. */
  changedIds: ReadonlySet<string>;
  snapshotVersion: number;
  onSelect: (component: PCBComponent | null) => void;
}

export function PCBScene({
  pcb,
  isRunning,
  selectedId,
  changedIds,
  snapshotVersion,
  onSelect,
}: PCBSceneProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const [userMoved, setUserMoved] = useState(false);

  // Idle drift stops for good once the viewer takes the camera themselves.
  const idle = !isRunning && !userMoved;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 9.5, 10], fov: 40, near: 0.1, far: 100 }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#0a0c0e"]} />

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
    </Canvas>
  );
}
