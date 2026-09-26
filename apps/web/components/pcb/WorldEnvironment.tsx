"use client";

import { useMemo, useRef } from "react";
import { BackSide, Color, ShaderMaterial } from "three";

/**
 * Procedural surround for the board. A large inverted sphere shaded from a
 * world-space vertical gradient, with a faint bloom behind the board and a
 * little grain to stop the darks from banding.
 *
 * Generated rather than loaded: no HDR asset, no network, a few hundred bytes
 * of GLSL. It reads as atmosphere, not as scenery.
 */

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uGlow;
  varying vec3 vWorld;

  // Cheap hash noise, used only to dither the gradient.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec3 dir = normalize(vWorld);

    // Vertical gradient: bottom -> horizon -> top, with the horizon band tight
    // enough to read as a falloff rather than a sky.
    float h = dir.y;
    vec3 col = h > 0.0
      ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55))
      : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.42));

    // A soft pool of light sitting behind and slightly above the board, so the
    // board reads against something rather than against a void.
    float bloom = pow(max(0.0, 1.0 - length(dir - normalize(vec3(0.0, 0.18, -1.0))) * 0.78), 3.0);
    col += uGlow * bloom * 0.5;

    // Dither: breaks up banding across these very dark values.
    col += (hash(gl_FragCoord.xy) - 0.5) * 0.006;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function WorldEnvironment() {
  const material = useRef<ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTop: { value: new Color("#05070a") },
      uHorizon: { value: new Color("#121a24") },
      uBottom: { value: new Color("#040506") },
      uGlow: { value: new Color("#1d3b4a") },
    }),
    [],
  );

  return (
    <mesh scale={[-1, 1, 1]} frustumCulled={false}>
      <sphereGeometry args={[60, 32, 24]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertex}
        fragmentShader={fragment}
        side={BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}
