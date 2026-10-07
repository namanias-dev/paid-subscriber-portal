"use client";

import dynamic from "next/dynamic";
import type { NotesPoint } from "@/lib/analytics/notesVisuals";
import type { FulfillmentPoint } from "@/lib/analytics/notesIntel";

const SalesTimeline = dynamic(() => import("./SalesTimeline"), {
  ssr: false,
  loading: () => <div className="mt-4 h-[340px] rounded-2xl bg-white p-4"><div className="h-[280px] animate-pulse rounded-xl bg-ca-navy/[0.04]" /></div>,
});

export default function SalesChartSlot({
  points,
  fulfillment,
  grain,
  subtitle,
}: {
  points: NotesPoint[];
  fulfillment?: FulfillmentPoint[] | null;
  grain: "hour" | "day";
  subtitle: string;
}) {
  return <SalesTimeline points={points} fulfillment={fulfillment} grain={grain} subtitle={subtitle} />;
}
