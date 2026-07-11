"use client";

import { Card, RiskPill, SectionTitle, Skeleton, useApi } from "@/components/kit";
import type { InboxItem } from "@/lib/agents/models";

export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  const { data, error, loading } = useApi<{ items: InboxItem[]; readOnly: boolean }>("/api/approvals");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-white">Approval Inbox</h1>
        <p className="text-sm text-muted">Sensitive actions require your explicit approval. In this release, approval &amp; execution are disabled.</p>
      </div>

      <Card className="border-warning/40 bg-warning/5">
        <p className="text-sm text-warning">
          🔒 Read-only mode. Every item below is a <strong>draft</strong>. AIVA will not send SMS, create tasks, publish, or change any record until amber/red actions are explicitly enabled after preview validation.
        </p>
      </Card>

      {loading ? (
        <Skeleton lines={4} />
      ) : error ? (
        <Card><p className="text-danger">{error}</p></Card>
      ) : (data?.items.length || 0) === 0 ? (
        <Card><p className="text-muted">No draft actions awaiting approval right now.</p></Card>
      ) : (
        <div className="space-y-2">
          {data!.items.map((r) => (
            <Card key={`${r.agent}:${r.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="aiva-label">{r.agentName}</div>
                  <div className="font-semibold text-white">{r.title}</div>
                  <div className="text-sm text-muted">{r.rationale}</div>
                  {r.tool ? <div className="mt-1 font-mono text-[11px] text-muted">tool: {r.tool}</div> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <RiskPill risk={r.risk} />
                  <span className="aiva-chip border-warning/50 text-warning">disabled</span>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="aiva-btn-ghost cursor-not-allowed opacity-50" disabled title="Disabled in read-only mode">Approve</button>
                <button className="aiva-btn-ghost cursor-not-allowed opacity-50" disabled title="Disabled in read-only mode">Reject</button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
