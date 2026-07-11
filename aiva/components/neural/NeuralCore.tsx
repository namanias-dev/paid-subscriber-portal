"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import NeuralCore2D from "./NeuralCore2D";
import { useApi } from "@/components/kit";
import type { Pulse } from "@/lib/events/projection";

const NeuralCore3D = dynamic(() => import("./NeuralCore3D"), { ssr: false, loading: () => <CoreSkeleton /> });

function CoreSkeleton() {
  return <div className="mx-auto aspect-square w-full max-w-[520px] aiva-skeleton" />;
}

function webglSupported(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch {
    return false;
  }
}

/** Picks the premium WebGL brain when supported + enabled; otherwise the GPU-free 2D fallback. */
export default function NeuralCore({ enable3d }: { enable3d: boolean }) {
  const { data, loading } = useApi<{ pulses: Pulse[] }>("/api/pulses");
  const [use3d, setUse3d] = useState(false);

  useEffect(() => {
    if (!enable3d) return;
    const lowPower = navigator.hardwareConcurrency ? navigator.hardwareConcurrency <= 2 : false;
    setUse3d(webglSupported() && !lowPower);
  }, [enable3d]);

  const pulses = data?.pulses || [];

  return (
    <div>
      {use3d ? <NeuralCore3D pulses={pulses} /> : <NeuralCore2D pulses={pulses} />}
      <PulseLegend loading={loading} count={pulses.length} />
    </div>
  );
}

function PulseLegend({ loading, count }: { loading: boolean; count: number }) {
  const items: [string, string][] = [
    ["#16a34a", "Payment"],
    ["#f2c94c", "Hot lead"],
    ["#dc2626", "Overdue / failed"],
    ["#38bdf8", "Class / quiz"],
    ["#a855f7", "Campaign"],
    ["#fb923c", "Needs review"],
    ["#e8ecf6", "Agent / sync"],
  ];
  return (
    <div className="mt-4">
      <div className="mb-2 text-center text-xs text-muted">
        {loading ? "Loading live activity…" : `${count} real events in the last window`}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {items.map(([c, label]) => (
          <span key={label} className="aiva-chip border-line text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
