"use client";

import dynamic from "next/dynamic";
import type { NotesPoint } from "@/lib/analytics/notesVisuals";

const SalesTimeline = dynamic(() => import("./SalesTimeline"), {
  ssr: false,
  loading: () => <div className="mt-4 h-[300px] rounded-2xl bg-white p-4"><div className="h-[240px] animate-pulse rounded-xl bg-[var(--ca-navy)]/[0.04]" /></div>,
});

export default function SalesChartSlot({ points, grain, subtitle }: { points: NotesPoint[]; grain: "hour" | "day"; subtitle: string }) {
  return <SalesTimeline points={points} grain={grain} subtitle={subtitle} />;
}
