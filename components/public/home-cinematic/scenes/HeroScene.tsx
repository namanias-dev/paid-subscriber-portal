"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * WebGL scene 1 of 2 — the hero's golden knowledge-particle field plus a subtle
 * Ashoka-inspired radial geometry, sitting BEHIND the real portrait.
 *
 * Constraints this scene is built to:
 *   • It owns no text. Every word in the hero is server-rendered HTML.
 *   • It is pure decoration, `pointer-events: none`, and `aria-hidden`.
 *   • Geometry is procedural — no GLTF, nothing to download, nothing to license.
 *   • Particle count and DPR come from the device tier, not from screen width.
 *   • Every geometry and material it creates is disposed on unmount (see
 *     `SceneDisposer`), because this route can be entered and left repeatedly.
 *
 * Deliberately uses `meshBasicMaterial` and additive blending throughout: there
 * are no lights and no shadow maps in this scene at all, which is what keeps it
 * affordable on a mid-tier Android.
 */

const GOLD = "#e8bf58";
const GOLD_BRIGHT = "#f7dc94";

/** Drifting gold "knowledge" particles. One BufferGeometry, one draw call. */
function ParticleField({ count, reduced }: { count: number; reduced: boolean }) {
  const points = useRef<THREE.Points>(null);

  const { positions, speeds } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Spherical-ish shell so density reads as depth rather than a flat sheet.
      const r = 3.2 + Math.random() * 5.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
      pos[i * 3 + 2] = r * Math.cos(phi) * 0.5 - 1.5;
      spd[i] = 0.15 + Math.random() * 0.5;
    }
    return { positions: pos, speeds: spd };
  }, [count]);

  useFrame((state, delta) => {
    const p = points.current;
    if (!p) return;
    // Whole-field rotation is far cheaper than per-particle CPU updates, and at
    // this scale reads identically.
    p.rotation.y += delta * (reduced ? 0.008 : 0.022);
    const attr = p.geometry.getAttribute("position") as THREE.BufferAttribute;
    // Gentle vertical breathing on a strided subset keeps CPU cost bounded
    // regardless of particle count.
    const t = state.clock.elapsedTime;
    const stride = Math.max(1, Math.floor(count / 90));
    for (let i = 0; i < count; i += stride) {
      attr.array[i * 3 + 1] += Math.sin(t * speeds[i]) * 0.0016;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={GOLD}
        size={0.035}
        sizeAttenuation
        transparent
        opacity={0.75}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/**
 * Ashoka-INSPIRED radial geometry. This is an abstract 24-spoke radial motif, not
 * a reproduction of the State Emblem: it is uniform, always perfectly circular
 * (never non-uniformly scaled), and carries no national insignia detail.
 */
function RadialMotif({ spokes = 24, reduced }: { spokes?: number; reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const innerR = 0.5;
  const outerR = 2.5;
  const midR = (innerR + outerR) / 2;
  const spokeLen = outerR - innerR;

  const angles = useMemo(() => Array.from({ length: spokes }, (_, i) => (i * Math.PI * 2) / spokes), [spokes]);

  // Share ONE geometry + ONE material across all spokes via instancing, so 24
  // spokes cost a single draw call instead of 24.
  const instanced = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = instanced.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    angles.forEach((a, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
      m.compose(new THREE.Vector3(-Math.sin(a) * midR, Math.cos(a) * midR, 0), q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [angles, midR]);

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.z -= delta * (reduced ? 0.01 : 0.04);
  });

  return (
    <group ref={group} position={[0, 0, -1]}>
      <mesh>
        <torusGeometry args={[outerR, 0.014, 8, 120]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.85} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh>
        <torusGeometry args={[innerR, 0.016, 8, 48]} />
        <meshBasicMaterial color={GOLD_BRIGHT} transparent opacity={0.8} blending={THREE.AdditiveBlending} />
      </mesh>
      <instancedMesh ref={instanced} args={[undefined, undefined, angles.length]}>
        <boxGeometry args={[0.016, spokeLen, 0.016]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.6} blending={THREE.AdditiveBlending} />
      </instancedMesh>
    </group>
  );
}

/**
 * Explicitly dispose the whole scene graph plus the renderer's internal caches on
 * unmount. R3F disposes objects it created declaratively, but the renderer's
 * programs/texture cache and any geometry we built in a `useMemo` need the
 * explicit walk to guarantee we do not accumulate GPU memory across the five
 * route transitions this preview is QA'd against.
 */
function SceneDisposer() {
  const { gl, scene } = useThree();
  useEffect(() => {
    return () => {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
        mesh.geometry?.dispose?.();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      gl.renderLists.dispose();
      gl.dispose();
    };
  }, [gl, scene]);
  return null;
}

export interface HeroSceneProps {
  /** Render loop runs only while true (off-screen / hidden tab → false). */
  active: boolean;
  particles: number;
  dprCap: number;
  reduced?: boolean;
}

export default function HeroScene({ active, particles, dprCap, reduced = false }: HeroSceneProps) {
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={[1, dprCap]}
      frameloop={active ? "always" : "never"}
      camera={{ position: [0, 0, 7], fov: 45 }}
      gl={{ antialias: dprCap > 1, alpha: true, powerPreference: "low-power", stencil: false, depth: true }}
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
    >
      <SceneDisposer />
      <ParticleField count={particles} reduced={reduced} />
      <RadialMotif reduced={reduced} />
    </Canvas>
  );
}
