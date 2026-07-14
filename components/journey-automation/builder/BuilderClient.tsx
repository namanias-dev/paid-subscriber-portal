"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import JourneyMonitor from "./JourneyMonitor";
import type { BuilderPerms } from "./JourneyBuilder";

// Route-level lazy load: the canvas library (@xyflow/react) is only ever pulled
// into THIS route's client chunk, and only on desktop where the builder renders.
const JourneyBuilder = dynamic(() => import("./JourneyBuilder"), {
  ssr: false,
  loading: () => <div className="card p-10 text-center text-sm text-muted">Loading builder…</div>,
});

export default function BuilderClient({ workflowId, perms }: { workflowId: string; perms: BuilderPerms }) {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setIsDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  if (isDesktop === null) return <div className="card p-10 text-center text-sm text-muted">Loading…</div>;
  if (!isDesktop) return <JourneyMonitor workflowId={workflowId} />;
  return <JourneyBuilder workflowId={workflowId} perms={perms} />;
}
