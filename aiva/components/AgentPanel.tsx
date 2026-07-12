"use client";

import { Card, Kpi, SectionTitle, RiskPill, Skeleton, useApi } from "@/components/kit";
import { useDrill } from "@/components/drill/DrillProvider";
import OpenInPortal from "@/components/portal/OpenInPortal";
import { paymentsLink, webinarLink, studentLink, courseLink, type PortalLink } from "@/lib/portal/links";
import Sparkline from "@/components/Sparkline";
import type { AgentSnapshot } from "@/lib/agents/models";

function agentPortalLinks(domain: string): PortalLink[] {
  switch (domain) {
    case "revenue": return [paymentsLink()];
    case "analytics": return [webinarLink()];
    case "admissions": return [studentLink(), courseLink()];
    case "operations": return [paymentsLink()];
    case "batch_launch": return [courseLink(), webinarLink()];
    default: return [];
  }
}

export default function AgentPanel({ domain }: { domain: string }) {
  const { data, error, loading } = useApi<{ snapshot: AgentSnapshot }>(`/api/agents/${domain}`);
  const { openDrill } = useDrill();

  if (loading) return <Skeleton lines={5} />;
  if (error || !data) return <Card><p className="text-danger">Could not load agent: {error}</p></Card>;

  const s = data.snapshot;
  const portalLinks = agentPortalLinks(domain);
  const max = Math.max(1, ...(s.funnel || []).map((f) => f.value));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: s.agent.color }} />
          <h1 className="font-heading text-2xl font-extrabold text-white">{s.agent.name} Agent</h1>
        </div>
        <p className="text-sm text-muted">{s.agent.blurb}</p>
        {portalLinks.length > 0 ? <div className="mt-2"><OpenInPortal links={portalLinks} size="xs" /></div> : null}
      </div>

      {s.headline ? (
        <div className="aiva-headline">
          <span className="aiva-headline-icon" aria-hidden>◆</span>
          <p>{s.headline}</p>
        </div>
      ) : null}

      {s.sparkline && s.sparkline.length > 1 ? <Sparkline values={s.sparkline} label={s.sparklineLabel} /> : null}

      {s.metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {s.metrics.map((m) =>
            m.drill ? (
              <button key={m.label} type="button" className="aiva-kpi aiva-kpi-clickable text-left" onClick={() => openDrill({ domain, metric: m.drill!, label: m.label })} aria-label={`Show records behind ${m.label}`}>
                <div className="aiva-label">{m.label} <span className="aiva-kpi-drill" aria-hidden>↗</span></div>
                <div className="mt-1 font-heading text-2xl font-bold text-white">{m.value}</div>
                {m.hint ? <div className="mt-0.5 text-xs text-muted">{m.hint}</div> : null}
              </button>
            ) : (
              <Kpi key={m.label} label={m.label} value={m.value} hint={m.hint} />
            ),
          )}
        </div>
      )}

      {s.funnel && s.funnel.length > 0 ? (
        <Card>
          <div className="aiva-label mb-2">{s.funnelTitle || "Breakdown"}</div>
          <div className="space-y-1.5">
            {s.funnel.map((f) => {
              const inner = (
                <>
                  <div className="aiva-funnel-head">
                    <span className="aiva-funnel-label">{f.label}{f.drill ? <span className="aiva-kpi-drill" aria-hidden> ↗</span> : null}</span>
                    <span className="aiva-funnel-value">{f.value}{f.sub ? <span className="aiva-funnel-sub"> · {f.sub}</span> : null}</span>
                  </div>
                  <div className="aiva-funnel-track"><div className="aiva-funnel-fill" style={{ width: `${Math.round((f.value / max) * 100)}%` }} /></div>
                </>
              );
              return f.drill ? (
                <button key={f.label} type="button" className="aiva-funnel-row aiva-funnel-row-clickable w-full text-left" onClick={() => openDrill({ domain, metric: f.drill!, label: f.label })}>{inner}</button>
              ) : (
                <div key={f.label} className="aiva-funnel-row">{inner}</div>
              );
            })}
          </div>
        </Card>
      ) : null}

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

      {s.caveats && s.caveats.length > 0 ? (
        <div>
          <div className="aiva-label mb-1">Data notes</div>
          <ul className="space-y-1">
            {s.caveats.map((c, i) => (
              <li key={i} className="aiva-caveat">{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {s.note ? <p className="text-sm text-muted">{s.note}</p> : null}
    </div>
  );
}
