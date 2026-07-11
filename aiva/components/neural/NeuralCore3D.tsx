"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { AGENTS } from "@/lib/agents/registry";
import type { Pulse } from "@/lib/events/projection";

const PULSE_COLOR: Record<string, string> = {
  green: "#16a34a",
  gold: "#f2c94c",
  red: "#dc2626",
  blue: "#38bdf8",
  purple: "#a855f7",
  orange: "#fb923c",
  white: "#e8ecf6",
};

const RADIUS = 2.7;

function nodePositions(): Record<string, THREE.Vector3> {
  const map: Record<string, THREE.Vector3> = {};
  const n = AGENTS.length;
  AGENTS.forEach((a, i) => {
    const angle = (i / n) * Math.PI * 2;
    const z = Math.sin(i * 1.7) * 0.6;
    map[a.id] = new THREE.Vector3(RADIUS * Math.cos(angle), RADIUS * Math.sin(angle), z);
  });
  return map;
}

function Core() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.25;
  });
  return (
    <group>
      <mesh ref={ref}>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshStandardMaterial color="#0057ff" emissive="#f2c94c" emissiveIntensity={0.5} metalness={0.6} roughness={0.25} wireframe />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial color="#f2c94c" emissive="#c9a227" emissiveIntensity={1.4} />
      </mesh>
      <pointLight position={[0, 0, 0]} intensity={6} distance={8} color="#4d8bff" />
    </group>
  );
}

function AgentNode({ position, color }: { position: THREE.Vector3; color: string }) {
  const positions = useMemo(() => new Float32Array([0, 0, 0, position.x, position.y, position.z]), [position]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  return (
    <group>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <line>
        <primitive object={geo} attach="geometry" />
        <lineBasicMaterial color={color} transparent opacity={0.35} />
      </line>
      <mesh position={position}>
        <sphereGeometry args={[0.14, 20, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} />
      </mesh>
    </group>
  );
}

function PulseDot({ from, color, phase, dur }: { from: THREE.Vector3; color: string; phase: number; dur: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = ((state.clock.elapsedTime + phase) % dur) / dur; // 0..1
    ref.current.position.lerpVectors(from, new THREE.Vector3(0, 0, 0), t);
    const s = 0.06 + 0.06 * Math.sin(t * Math.PI);
    ref.current.scale.setScalar(s / 0.06);
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.sin(t * Math.PI);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.06, 12, 12]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} />
    </mesh>
  );
}

function Scene({ pulses, reducedMotion }: { pulses: Pulse[]; reducedMotion: boolean }) {
  const positions = useMemo(nodePositions, []);
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (group.current && !reducedMotion) group.current.rotation.z += dt * 0.04;
  });

  const dots = useMemo(() => {
    return pulses.slice(0, 22).map((p, i) => ({
      key: p.id,
      from: positions[p.domain] || new THREE.Vector3(RADIUS, 0, 0),
      color: PULSE_COLOR[p.color] || "#e8ecf6",
      phase: i * 0.7,
      dur: 3.2 + (i % 5) * 0.4,
    }));
  }, [pulses, positions]);

  return (
    <group ref={group}>
      <ambientLight intensity={0.4} />
      <pointLight position={[6, 6, 6]} intensity={1.2} />
      <Core />
      {AGENTS.map((a) => (
        <AgentNode key={a.id} position={positions[a.id]} color={a.color} />
      ))}
      {!reducedMotion && dots.map((d) => <PulseDot key={d.key} from={d.from} color={d.color} phase={d.phase} dur={d.dur} />)}
    </group>
  );
}

export default function NeuralCore3D({ pulses }: { pulses: Pulse[] }) {
  const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className="mx-auto aspect-square w-full max-w-[520px]">
      <Canvas camera={{ position: [0, 0, 7], fov: 50 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}>
        <Scene pulses={pulses} reducedMotion={!!reducedMotion} />
      </Canvas>
    </div>
  );
}
