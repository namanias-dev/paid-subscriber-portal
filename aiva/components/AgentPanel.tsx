"use client";

import { Card, Kpi, SectionTitle, RiskPill, Skeleton, useApi } from "@/components/kit";
import type { AgentSnapshot } from "@/lib/agents/models";

export default function AgentPanel({ domain }: { domain: string }) {
  const { data, error, loading } = useApi<{ snapshot: AgentSnapshot }>(`/api/agents/${domain}`);

  if (loading) return <Skeleton lines={5} />;
  if (error || !data) return <Card><p className="text-danger">Could not load agent: {error}</p></Card>;

  const s = data.snapshot;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: s.agent.color }} />
          <h1 className="font-heading text-2xl font-extrabold text-white">{s.agent.name} Agent</h1>
        </div>
        <p className="text-sm text-muted">{s.agent.blurb}</p>
      </div>

      {s.metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {s.metrics.map((m) => (
            <Kpi key={m.label} label={m.label} value={m.value} hint={m.hint} />
          ))}
        </div>
      )}

      <Card>
        <SectionTitle sub="Recommendations are drafts. Actions execute only after this release enables them.">
          Recommendations & action drafts
        </SectionTitle>
        {s.recommendations.length === 0 ? (
          <p className="text-sm text-muted">No draft actions right now.</p>
        ) : (
          <ul className="space-y-2">
            {s.recommendations.map((r) => (
              <li key={r.id} className="rounded-xl border border-line bg-navy-700/30 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">{r.title}</div>
                    <div className="text-sm text-muted">{r.rationale}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <RiskPill risk={r.risk} />
                    <span className={`aiva-chip ${r.executable ? "border-success/50 text-success" : "border-warning/50 text-warning"}`}>
                      {r.executable ? "available" : "disabled"}
                    </span>
                  </div>
                </div>
                {!r.executable && r.blockedReason ? (
                  <p className="mt-2 text-xs text-warning">🔒 {r.blockedReason}</p>
                ) : null}
                {r.tool ? <p className="mt-1 font-mono text-[11px] text-muted">tool: {r.tool}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {s.note ? <p className="text-sm text-muted">{s.note}</p> : null}
    </div>
  );
}
