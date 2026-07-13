"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, Float } from "@react-three/drei";
import * as THREE from "three";

const GOLD = "#f2c94c";
const GOLD_DEEP = "#d4af37";
const GOLD_CORE = "#fff2c2";

/**
 * A dignified, procedurally-built Ashoka Chakra: a true circular rim, a small
 * central hub, and 24 evenly-spaced radial spokes. This is an INSPIRED-BY mark
 * (not a reproduction of the official State Emblem) rendered as glowing gold over
 * the deep-navy space. It rotates slowly and is never scaled non-uniformly, so it
 * stays perfectly round and dignified.
 */
function AshokaChakra3D() {
  const group = useRef<THREE.Group>(null);
  const innerR = 0.42;
  const outerR = 2.35;
  const midR = (innerR + outerR) / 2;
  const len = outerR - innerR;
  const spokes = useMemo(() => Array.from({ length: 24 }, (_, i) => (i * Math.PI * 2) / 24), []);

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.z -= delta * 0.05;
  });

  return (
    <group ref={group} position={[0, 0, -0.4]}>
      {/* Outer rim (double line for a crisp, engraved feel) */}
      <mesh>
        <torusGeometry args={[outerR, 0.018, 12, 160]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.9} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh>
        <torusGeometry args={[outerR - 0.09, 0.008, 10, 160]} />
        <meshBasicMaterial color={GOLD_DEEP} transparent opacity={0.5} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* Central hub */}
      <mesh>
        <torusGeometry args={[innerR, 0.02, 12, 64]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.9} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh>
        <circleGeometry args={[innerR * 0.34, 32]} />
        <meshBasicMaterial color={GOLD_CORE} />
      </mesh>

      {/* 24 uniform radial spokes */}
      {spokes.map((a, i) => (
        <mesh key={i} rotation={[0, 0, a]} position={[-Math.sin(a) * midR, Math.cos(a) * midR, 0]}>
          <boxGeometry args={[0.02, len, 0.02]} />
          <meshBasicMaterial color={GOLD} transparent opacity={0.85} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}

      {/* Soft glow disc behind the chakra */}
      <mesh position={[0, 0, -0.25]}>
        <circleGeometry args={[outerR * 1.05, 48]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.06} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

/** Concentric Chakra-inspired wireframe rings for aspirational depth. */
function ConcentricRings() {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.z += delta * 0.03;
  });
  return (
    <group ref={group}>
      <mesh rotation={[Math.PI / 2.5, 0, 0]}>
        <torusGeometry args={[3.1, 0.006, 8, 160]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.4} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh rotation={[Math.PI / 2.2, Math.PI / 6, 0]}>
        <torusGeometry args={[3.7, 0.005, 8, 160]} />
        <meshBasicMaterial color={GOLD_DEEP} transparent opacity={0.28} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

/** Build a flat 5-point star shape once (IPS-insignia inspired accent). */
function useStarGeometry(outer: number, inner: number) {
  return useMemo(() => {
    const shape = new THREE.Shape();
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const ang = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [outer, inner]);
}

/** A single glowing gold IPS-style star accent that gently floats. */
function IpsStar({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  const geo = useStarGeometry(0.2, 0.08);
  return (
    <Float speed={1.4} rotationIntensity={0.5} floatIntensity={0.8}>
      <mesh geometry={geo} position={position} scale={scale}>
        <meshBasicMaterial color={GOLD_CORE} transparent opacity={0.9} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
    </Float>
  );
}

/** Ambient gold dust that drifts slowly for parallax depth. */
function GoldDust() {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 200;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 14;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 12;
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
 * Hero 3D backdrop — a slowly rotating gold Ashoka Chakra + concentric wireframe
 * rings + IPS-style star accents + ambient gold dust and starfield, all behind
 * the framed portrait. Rendered ONLY on capable desktops via a lazy, ssr:false
 * dynamic import, and paused (frameloop="never") when the hero scrolls out of
 * view. It is pure decoration; it owns no text and never blocks LCP.
 */
export default function HeroCanvas({ active = true }: { active?: boolean }) {
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={[1, 1.5]}
      frameloop={active ? "always" : "never"}
      camera={{ position: [0, 0, 7], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ pointerEvents: "none" }}
    >
      <Stars radius={70} depth={40} count={1200} factor={3} saturation={0} fade speed={0.5} />
      <GoldDust />
      <ConcentricRings />
      <Float speed={0.8} rotationIntensity={0.15} floatIntensity={0.5}>
        <AshokaChakra3D />
      </Float>
      <IpsStar position={[2.9, 1.9, 0.4]} scale={1} />
      <IpsStar position={[-2.8, -1.8, 0.2]} scale={0.8} />
    </Canvas>
  );
}
