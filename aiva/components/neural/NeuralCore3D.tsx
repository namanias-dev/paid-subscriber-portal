"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { AGENTS } from "@/lib/agents/registry";
import { nodeLayout, activityByDomain, synapseEdges, PULSE_HEX, type Vec3 } from "@/lib/neural/graph";
import type { Pulse } from "@/lib/events/projection";

function v(p: Vec3): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[1], p[2]);
}

/** Glowing, slowly-breathing core at the centre of the brain. */
function Core() {
  const shell = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  useFrame((state, dt) => {
    if (shell.current) shell.current.rotation.y += dt * 0.3;
    if (halo.current) {
      const s = 1 + 0.06 * Math.sin(state.clock.elapsedTime * 1.6);
      halo.current.scale.setScalar(s);
    }
  });
  return (
    <group>
      <mesh ref={shell}>
        <icosahedronGeometry args={[0.78, 1]} />
        <meshStandardMaterial color="#0057ff" emissive="#f2c94c" emissiveIntensity={0.55} metalness={0.6} roughness={0.25} wireframe />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial color="#f2c94c" emissive="#c9a227" emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[0.66, 24, 24]} />
        <meshBasicMaterial color="#4d8bff" transparent opacity={0.12} />
      </mesh>
      <pointLight position={[0, 0, 0]} intensity={6} distance={9} color="#4d8bff" />
    </group>
  );
}

function Edge({ a, b, color, active }: { a: Vec3; b: Vec3; color: string; active: boolean }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([a[0], a[1], a[2], b[0], b[1], b[2]]), 3));
    return g;
  }, [a, b]);
  return (
    // eslint-disable-next-line react/no-unknown-property
    <line>
      <primitive object={geo} attach="geometry" />
      <lineBasicMaterial color={color} transparent opacity={active ? 0.55 : 0.14} />
    </line>
  );
}

/** A single agent node: glow scales with activity; hover tooltip; click selects. */
function Node({
  id,
  name,
  blurb,
  color,
  pos,
  activity,
  selected,
  dimmed,
  onSelect,
  registerRef,
}: {
  id: string;
  name: string;
  blurb: string;
  color: string;
  pos: Vec3;
  activity: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  registerRef: (id: string, obj: THREE.Object3D | null) => void;
}) {
  const [hover, setHover] = useState(false);
  const core = useRef<THREE.Mesh>(null);
  const base = 0.15 + Math.min(activity, 10) * 0.01;
  const glow = 0.55 + Math.min(activity, 10) * 0.11 + (hover || selected ? 0.7 : 0);

  useFrame((state) => {
    if (!core.current) return;
    const breathe = 1 + 0.14 * Math.sin(state.clock.elapsedTime * 2 + pos[0] * 2);
    const emphasize = selected ? 1.5 : hover ? 1.3 : 1;
    core.current.scale.setScalar(breathe * emphasize);
  });

  return (
    <group position={pos} ref={(o) => registerRef(id, o)}>
      <mesh
        ref={core}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          if (typeof document !== "undefined") document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          if (typeof document !== "undefined") document.body.style.cursor = "default";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
      >
        <sphereGeometry args={[base, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} toneMapped={false} />
      </mesh>
      <mesh scale={selected ? 2.6 : hover ? 2.1 : 1.7}>
        <sphereGeometry args={[base, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.05 : 0.14} />
      </mesh>
      <Html center position={[0, base + 0.22, 0]} distanceFactor={9} zIndexRange={[12, 0]} style={{ pointerEvents: "none" }}>
        <div className={`neural-label ${selected ? "is-active" : ""} ${dimmed ? "is-dim" : ""}`}>{name}</div>
      </Html>
      {hover ? (
        <Html center position={[0, base + 0.6, 0]} distanceFactor={7} zIndexRange={[60, 40]} style={{ pointerEvents: "none" }}>
          <div className="neural-tip">
            <strong>{name}</strong>
            <span>{blurb}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/** Small energy packet travelling from an active node into the core. */
function PulseDot({ from, color, phase, dur }: { from: THREE.Vector3; color: string; phase: number; dur: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const target = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  useFrame((state) => {
    if (!ref.current) return;
    const t = ((state.clock.elapsedTime + phase) % dur) / dur;
    ref.current.position.lerpVectors(from, target, t);
    ref.current.scale.setScalar(1 + Math.sin(t * Math.PI));
    (ref.current.material as THREE.MeshBasicMaterial).opacity = Math.sin(t * Math.PI);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.055, 12, 12]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} />
    </mesh>
  );
}

/** Smoothly flies the camera toward the selected node and back to the overview. */
function CameraRig({ selected, nodeRefs }: { selected: string | null; nodeRefs: MutableRefObject<Record<string, THREE.Object3D | null>> }) {
  const { camera } = useThree();
  const tmp = useRef(new THREE.Vector3());
  const desired = useRef(new THREE.Vector3(0, 0, 7));
  const look = useRef(new THREE.Vector3(0, 0, 0));
  useFrame(() => {
    const obj = selected ? nodeRefs.current[selected] : null;
    if (obj) {
      obj.getWorldPosition(tmp.current);
      const dir = tmp.current.clone().normalize();
      desired.current.copy(tmp.current.clone().add(dir.multiplyScalar(2.1)));
      look.current.lerp(tmp.current, 0.12);
    } else {
      desired.current.set(0, 0, 7);
      look.current.lerp(new THREE.Vector3(0, 0, 0), 0.12);
    }
    camera.position.lerp(desired.current, 0.07);
    camera.lookAt(look.current);
  });
  return null;
}

function Scene({
  pulses,
  selected,
  onSelect,
  reducedMotion,
  maxDots,
}: {
  pulses: Pulse[];
  selected: string | null;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
  maxDots: number;
}) {
  const layout = useMemo(() => nodeLayout(), []);
  const activity = useMemo(() => activityByDomain(pulses), [pulses]);
  const edges = useMemo(() => synapseEdges(2), []);
  const nodeRefs = useRef<Record<string, THREE.Object3D | null>>({});
  const spin = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    if (spin.current && !reducedMotion && !selected) spin.current.rotation.y += dt * 0.09;
  });

  const dots = useMemo(() => {
    return pulses.slice(0, maxDots).map((p, i) => ({
      key: p.id,
      from: v(layout[p.domain] || [2.8, 0, 0]),
      color: PULSE_HEX[p.color] || "#e8ecf6",
      phase: i * 0.6,
      dur: 3 + (i % 5) * 0.45,
    }));
  }, [pulses, layout, maxDots]);

  return (
    <>
      <CameraRig selected={selected} nodeRefs={nodeRefs} />
      <ambientLight intensity={0.5} />
      <pointLight position={[6, 6, 6]} intensity={1.1} />
      <group ref={spin}>
        <Core />
        {edges.map(([a, b]) => (
          <Edge key={`${a}-${b}`} a={layout[a]} b={layout[b]} color="#2a3f74" active={(activity[a] || 0) + (activity[b] || 0) > 0} />
        ))}
        {AGENTS.map((a) => (
          <Edge key={`core-${a.id}`} a={[0, 0, 0]} b={layout[a.id]} color={a.color} active={(activity[a.id] || 0) > 0} />
        ))}
        {AGENTS.map((a) => (
          <Node
            key={a.id}
            id={a.id}
            name={a.name}
            blurb={a.blurb}
            color={a.color}
            pos={layout[a.id]}
            activity={activity[a.id] || 0}
            selected={selected === a.id}
            dimmed={!!selected && selected !== a.id}
            onSelect={onSelect}
            registerRef={(id, o) => {
              nodeRefs.current[id] = o;
            }}
          />
        ))}
        {!reducedMotion ? dots.map((d) => <PulseDot key={d.key} from={d.from} color={d.color} phase={d.phase} dur={d.dur} />) : null}
      </group>
    </>
  );
}

export default function NeuralCore3D({
  pulses,
  selected,
  onSelect,
}: {
  pulses: Pulse[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const reducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const small = typeof window !== "undefined" && window.innerWidth < 640;
  return (
    <div className="mx-auto aspect-square w-full max-w-[560px]">
      <Canvas
        camera={{ position: [0, 0, 7], fov: 50 }}
        dpr={small ? [1, 1.4] : [1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onPointerMissed={() => onSelect("")}
      >
        <Scene pulses={pulses} selected={selected || null} onSelect={onSelect} reducedMotion={reducedMotion} maxDots={small ? 12 : 22} />
      </Canvas>
    </div>
  );
}
