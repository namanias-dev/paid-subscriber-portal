"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, Float } from "@react-three/drei";
import * as THREE from "three";

const GOLD = "#f2c94c";
const GOLD_DEEP = "#d4af37";

/**
 * Gold "north-star / compass" motif — abstract, low-poly, procedural (no GLTF).
 * A slowly rotating wireframe icosahedron + halo ring + a bright compass star,
 * all additive/emissive so they read as glowing gold over the deep-navy space.
 */
function CompassStar() {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 0.12;
      group.current.rotation.z += delta * 0.04;
    }
  });
  return (
    <Float speed={1.1} rotationIntensity={0.4} floatIntensity={0.9}>
      <group ref={group} position={[2.4, 0.3, 0]} scale={1.15}>
        {/* Outer wireframe shell */}
        <mesh>
          <icosahedronGeometry args={[1.5, 1]} />
          <meshBasicMaterial color={GOLD} wireframe transparent opacity={0.35} />
        </mesh>
        {/* Halo ring */}
        <mesh rotation={[Math.PI / 2.6, 0, 0]}>
          <torusGeometry args={[2.15, 0.012, 8, 120]} />
          <meshBasicMaterial color={GOLD} transparent opacity={0.8} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]}>
          <torusGeometry args={[1.8, 0.008, 8, 120]} />
          <meshBasicMaterial color={GOLD_DEEP} transparent opacity={0.6} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Compass star core (two crossed octahedra) */}
        <mesh scale={[0.42, 0.42, 0.42]}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color="#fff2c2" />
        </mesh>
        <mesh scale={[0.9, 0.14, 0.14]}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={GOLD} transparent opacity={0.85} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh scale={[0.14, 0.9, 0.14]}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={GOLD} transparent opacity={0.85} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Soft glow sprite behind the core */}
        <mesh position={[0, 0, -0.2]}>
          <circleGeometry args={[1.1, 32]} />
          <meshBasicMaterial color={GOLD} transparent opacity={0.14} blending={THREE.AdditiveBlending} />
        </mesh>
      </group>
    </Float>
  );
}

/** Ambient gold dust that drifts slowly for parallax depth. */
function GoldDust() {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 220;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 16;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 10;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 6 - 2;
    }
    return arr;
  }, []);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.02;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={GOLD} size={0.03} sizeAttenuation transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

/**
 * The full hero 3D backdrop. Rendered ONLY on capable desktops via a lazy,
 * ssr:false dynamic import, and paused (frameloop="never") when the hero scrolls
 * out of view. It is pure decoration behind the server-rendered hero text.
 */
export default function HeroCanvas({ active = true }: { active?: boolean }) {
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={[1, 1.5]}
      frameloop={active ? "always" : "never"}
      camera={{ position: [0, 0, 6], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ pointerEvents: "none" }}
    >
      <Stars radius={70} depth={40} count={1400} factor={3} saturation={0} fade speed={0.5} />
      <GoldDust />
      <CompassStar />
    </Canvas>
  );
}
