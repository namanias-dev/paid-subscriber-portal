"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import NeuralCore2D from "./NeuralCore2D";
import AgentDetailPanel from "./AgentDetailPanel";
import ActivityFeed from "./ActivityFeed";
import type { Pulse } from "@/lib/events/projection";

const NeuralCore3D = dynamic(() => import("./NeuralCore3D"), { ssr: false, loading: () => <CoreSkeleton /> });

function CoreSkeleton() {
  return <div className="mx-auto aspect-square w-full max-w-[560px] aiva-skeleton" />;
}

function webglSupported(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch {
    return false;
  }
}

const POLL_MS = 20_000;

/** JARVIS-style living brain: real agents as nodes, live event pulses, click-to-zoom detail. */
export default function NeuralCore({ enable3d }: { enable3d: boolean }) {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [collected, setCollected] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [use3d, setUse3d] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    if (!enable3d) return;
    const lowPower = navigator.hardwareConcurrency ? navigator.hardwareConcurrency <= 2 : false;
    setUse3d(webglSupported() && !lowPower);
  }, [enable3d]);

  useEffect(() => {
    mounted.current = true;
    const loadPulses = async () => {
      try {
        const r = await fetch("/api/pulses", { cache: "no-store" });
        const j = await r.json();
        if (mounted.current && r.ok && j.ok) setPulses(j.pulses || []);
      } catch {
        /* keep last good pulses */
      } finally {
        if (mounted.current) setLoading(false);
      }
    };
    const loadRevenue = async () => {
      try {
        const r = await fetch("/api/revenue", { cache: "no-store" });
        const j = await r.json();
        if (mounted.current && r.ok && j.ok) setCollected(Number(j.tower?.collected) || 0);
      } catch {
        /* summary chip is optional */
      }
    };
    loadPulses();
    loadRevenue();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      loadPulses();
      loadRevenue();
    }, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  const onSelect = useCallback((id: string) => {
    setSelected((prev) => (id === "" ? null : id === prev ? null : id));
  }, []);

  return (
    <div>
      <div className="neural-stage">
        {use3d ? (
          <NeuralCore3D pulses={pulses} selected={selected} onSelect={onSelect} />
        ) : (
          <NeuralCore2D pulses={pulses} selected={selected} onSelect={onSelect} />
        )}
        {selected ? <AgentDetailPanel domain={selected} onClose={() => setSelected(null)} /> : null}
      </div>

      <ActivityFeed pulses={pulses} loading={loading} collected={collected} onSelect={onSelect} />

      <p className="mt-3 text-center text-xs text-muted">
        Hover a node for its role · click to zoom in and see live numbers · every pulse is a real business event
      </p>
    </div>
  );
}
