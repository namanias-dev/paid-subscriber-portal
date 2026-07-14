"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Smartphone, Workflow } from "lucide-react";
import type { AutomationWorkflow, BuilderGraph } from "@/types/journey-automation";

/**
 * Read-only monitor view for tablet/mobile. The drag-drop builder is desktop-only
 * (cramped canvases are a poor experience); on small screens we show a calm,
 * read-only summary and never load the canvas library.
 */
export default function JourneyMonitor({ workflowId }: { workflowId: string }) {
  const [wf, setWf] = useState<AutomationWorkflow | null>(null);
  const [graph, setGraph] = useState<BuilderGraph | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/journey-automation/workflows/${workflowId}`)
      .then((r) => r.json())
      .then((res) => { if (alive && res?.ok) { setWf(res.workflow); setGraph(res.graph); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [workflowId]);

  if (loading) return <div className="card p-8 text-center text-sm text-muted">Loading…</div>;
  if (!wf) return <div className="card p-8 text-center text-sm text-muted">Workflow not found.</div>;

  return (
    <div>
      <Link href="/admin/communications/journey-automation" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink2">
        <ArrowLeft size={15} /> All journeys
      </Link>
      <div className="card p-5">
        <div className="flex items-center gap-2">
          <Workflow size={18} style={{ color: "var(--primary)" }} aria-hidden="true" />
          <h1 className="font-heading text-lg font-bold">{wf.name}</h1>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink2">
          <span className="pill pill-gray capitalize">{wf.status.replace(/_/g, " ")}</span>
          <span>{wf.published_version ? `Published v${wf.published_version}` : "Never published"}</span>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs" style={{ borderColor: "var(--primary)", background: "var(--primary-tint)", color: "var(--ink2)" }}>
          <Smartphone size={14} style={{ color: "var(--primary)" }} aria-hidden="true" />
          Open this journey on a desktop to edit the visual flow. This is a read-only monitor view.
        </div>
      </div>

      <h2 className="mb-2 mt-5 font-heading text-sm font-bold">Steps ({graph?.nodes.length ?? 0})</h2>
      <div className="space-y-2">
        {(graph?.nodes ?? []).map((n) => (
          <div key={n.node_key} className="card flex items-center justify-between p-3">
            <span className="text-sm font-medium">{String(n.config?.title ?? n.type)}</span>
            <span className="pill pill-gray capitalize">{String(n.type).replace(/_/g, " ")}</span>
          </div>
        ))}
        {(graph?.nodes.length ?? 0) === 0 && <p className="text-sm text-muted">No steps yet.</p>}
      </div>
    </div>
  );
}
