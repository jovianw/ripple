"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";

import type { PCBComponent, PCBState } from "@/lib/types";

// three touches window/document at import time, so keep it off the server.
const PCBScene = dynamic(
  () => import("./PCBScene").then((m) => m.PCBScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs text-white/40">
        Initialising renderer…
      </div>
    ),
  },
);

class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm text-white/70">3D view unavailable</p>
          <p className="max-w-sm text-xs text-white/40">
            This browser could not start WebGL. The build log and stage progress
            on the right still work.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PCBViewport(props: {
  pcb: PCBState;
  isRunning: boolean;
  selectedId: string | null;
  changedIds: ReadonlySet<string>;
  snapshotVersion: number;
  onSelect: (component: PCBComponent | null) => void;
}) {
  return (
    <SceneBoundary>
      <PCBScene {...props} />
    </SceneBoundary>
  );
}
