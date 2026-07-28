"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * WebGL scene 2 of 2 — the UPSC Journey.
 *
 * One canvas, one scroll-driven camera that travels along a rising golden path
 * through six waypoints (Direction → Foundation → Prelims+Mains → Testing &
 * Answer Writing → Interview → Civil Services), ending on a distant
 * institutional horizon.
 *
 * SCROLL CONTRACT — this is the important part:
 *   • The page scroll is NEVER intercepted. No wheel handler, no scroll-jacking,
 *     no `scrollTo`. The section is simply tall and the canvas is `sticky`, so
 *     the browser's own scrolling drives the camera. Back button, deep links,
 *     keyboard paging and browser scroll restoration all behave normally.
 *   • Progress arrives through a MUTABLE REF, not a prop. Feeding progress in as
 *     a prop would re-render the React tree on every scroll frame; the ref lets
 *     `useFrame` sample it at the renderer's own cadence with zero React work.
 *
 * All text for these six stages is server-rendered HTML in the parent section.
 * This scene is decoration and owns no content.
 */

const GOLD = "#e8bf58";
const GOLD_BRIGHT = "#f7dc94";
const STAGE_COUNT = 6;

export type ProgressRef = MutableRefObject<number>;

/** Waypoints the camera passes through, rising as the aspirant progresses. */
const WAYPOINTS: THREE.Vector3[] = Array.from({ length: STAGE_COUNT }, (_, i) => {
  const t = i / (STAGE_COUNT - 1);
  return new THREE.Vector3(Math.sin(t * Math.PI * 1.4) * 1.9, t * 4.6 - 1.1, 9 - t * 12.5);
});

const PATH = new THREE.CatmullRomCurve3(WAYPOINTS, false, "catmullrom", 0.4);

/** The glowing path itself, plus a milestone marker at each stage. */
function JourneyPath({ progress, reduced }: { progress: ProgressRef; reduced: boolean }) {
  const markers = useRef<THREE.InstancedMesh>(null);

  // A thin tube rather than a GL line: `lineWidth` is clamped to 1px on most
  // platforms, so a line would render as a hairline that all but disappears on a
  // high-DPR phone. The tube is a handful of triangles and always reads.
  const geometry = useMemo(() => new THREE.TubeGeometry(PATH, 140, 0.025, 6, false), []);

  useEffect(() => {
    const mesh = markers.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    WAYPOINTS.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  // Markers already passed glow brighter — a cheap, legible progress cue.
  useFrame((state) => {
    const mesh = markers.current;
    if (!mesh) return;
    const reached = progress.current * (STAGE_COUNT - 1);
    const pulse = reduced ? 1 : 1 + Math.sin(state.clock.elapsedTime * 1.6) * 0.06;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.55 + Math.min(1, reached / (STAGE_COUNT - 1)) * 0.35 * pulse;
  });

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={GOLD} transparent opacity={0.7} blending={THREE.AdditiveBlending} />
      </mesh>
      <instancedMesh ref={markers} args={[undefined, undefined, STAGE_COUNT]}>
        <sphereGeometry args={[0.11, 12, 12]} />
        <meshBasicMaterial color={GOLD_BRIGHT} transparent opacity={0.8} blending={THREE.AdditiveBlending} />
      </instancedMesh>
    </group>
  );
}

/** Ambient motes so the path reads as travelling through space, not a flat line. */
function Motes({ count, reduced }: { count: number; reduced: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 16;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 14;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 26 - 4;
    }
    return arr;
  }, [count]);

  useFrame((_, delta) => {
    if (ref.current && !reduced) ref.current.rotation.y += delta * 0.012;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={GOLD}
        size={0.03}
        sizeAttenuation
        transparent
        opacity={0.5}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/**
 * The distant institutional horizon the path resolves into: a wide, soft glowing
 * band with a colonnade suggestion. Abstract on purpose — no real building is
 * modelled or implied.
 */
function Horizon() {
  const cols = 13;
  const instanced = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = instanced.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < cols; i++) {
      m.makeTranslation((i - (cols - 1) / 2) * 0.62, 0, 0);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group position={[0, 3.1, -5.2]}>
      <mesh>
        <planeGeometry args={[16, 0.05]} />
        <meshBasicMaterial color={GOLD_BRIGHT} transparent opacity={0.5} blending={THREE.AdditiveBlending} />
      </mesh>
      <instancedMesh ref={instanced} args={[undefined, undefined, cols]} position={[0, 0.42, 0]}>
        <planeGeometry args={[0.055, 0.8]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.26} blending={THREE.AdditiveBlending} />
      </instancedMesh>
      <mesh position={[0, 0.3, -0.3]}>
        <planeGeometry args={[13, 2.4]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.05} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

/**
 * Moves the camera along the curve from scroll progress, with damping so a fast
 * flick reads as a glide rather than a jump.
 */
function ScrollCamera({ progress, reduced }: { progress: ProgressRef; reduced: boolean }) {
  const { camera } = useThree();
  const smoothed = useRef(0);
  const look = useMemo(() => new THREE.Vector3(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const target = THREE.MathUtils.clamp(progress.current, 0, 1);
    // Critically-damped follow, frame-rate independent.
    const lambda = reduced ? 24 : 6;
    smoothed.current = THREE.MathUtils.damp(smoothed.current, target, lambda, delta);
    const t = THREE.MathUtils.clamp(smoothed.current, 0, 1);

    PATH.getPointAt(t, pos);
    camera.position.set(pos.x * 0.55, pos.y * 0.5 + 0.6, pos.z + 6.2);
    // Always look slightly ahead up the path, ending on the horizon.
    PATH.getPointAt(Math.min(1, t + 0.12), look);
    camera.lookAt(look.x * 0.4, look.y * 0.5 + 1.1, look.z);
  });

  return null;
}

/** Explicit teardown of everything the scene put on the GPU. */
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

export interface JourneySceneProps {
  active: boolean;
  particles: number;
  dprCap: number;
  reduced?: boolean;
  progress: ProgressRef;
}

export default function JourneyScene({ active, particles, dprCap, reduced = false, progress }: JourneySceneProps) {
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={[1, dprCap]}
      frameloop={active ? "always" : "never"}
      camera={{ position: [0, 0, 12], fov: 52 }}
      gl={{ antialias: dprCap > 1, alpha: true, powerPreference: "low-power", stencil: false }}
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
    >
      <SceneDisposer />
      <ScrollCamera progress={progress} reduced={reduced} />
      <JourneyPath progress={progress} reduced={reduced} />
      <Motes count={Math.round(particles * 0.5)} reduced={reduced} />
      <Horizon />
    </Canvas>
  );
}
