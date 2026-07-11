"use client";

import Link from "next/link";
import { useApi, RiskPill, Skeleton } from "@/components/kit";
import { agentById } from "@/lib/agents/registry";

type Recommendation = {
  id: string;
  title: string;
  rationale: string;
  risk: string;
  executable: boolean;
  blockedReason?: string;
};

type FunnelBar = { label: string; value: number; sub?: string };

type Snapshot = {
  agent: { id: string; name: string; blurb: string; href: string };
  metrics: { label: string; value: string; hint?: string }[];
  recommendations: Recommendation[];
  note?: string;
  headline?: string;
  funnelTitle?: string;
  funnel?: FunnelBar[];
  caveats?: string[];
};

/** Slide-in panel shown when a Neural Core node is selected. Read-only agent snapshot. */
export default function AgentDetailPanel({ domain, onClose }: { domain: string; onClose: () => void }) {
  const meta = agentById(domain);
  const { data, loading, error } = useApi<{ snapshot: Snapshot }>(`/api/agents/${domain}`);
  const snap = data?.snapshot;

  return (
    <div className="neural-panel" role="dialog" aria-label={`${meta?.name || "Agent"} details`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="aiva-label">Agent</div>
          <h3 className="font-heading text-lg font-bold text-white">{meta?.name || domain}</h3>
        </div>
        <button className="aiva-btn-ghost px-3 py-1.5 text-xs" onClick={onClose} aria-label="Close agent panel">
          Close
        </button>
      </div>

      <div className="mb-4">
        <div className="aiva-label">What it does</div>
        <p className="text-sm text-ink">{meta?.blurb}</p>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <span className="neural-live-dot" />
        <span className="aiva-label">Live now — read-only from the database</span>
      </div>

      {loading ? (
        <Skeleton lines={3} />
      ) : error ? (
        <p className="text-sm text-danger">Could not load: {error}</p>
      ) : (
        <>
          {snap?.headline ? (
            <div className="aiva-headline mb-3">
              <span className="aiva-headline-icon" aria-hidden>◆</span>
              <p>{snap.headline}</p>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            {(snap?.metrics || []).map((m) => (
              <div key={m.label} className="aiva-kpi">
                <div className="aiva-label">{m.label}</div>
                <div className="mt-1 font-heading text-xl font-bold text-white">{m.value}</div>
                {m.hint ? <div className="mt-0.5 text-xs text-muted">{m.hint}</div> : null}
              </div>
            ))}
            {(!snap || snap.metrics.length === 0) && <p className="text-sm text-muted">No live metrics for this agent yet.</p>}
          </div>

          {snap?.funnel && snap.funnel.length > 0 ? (
            <div className="mt-4">
              <div className="aiva-label mb-2">{snap.funnelTitle || "Breakdown"}</div>
              <div className="space-y-1.5">
                {(() => {
                  const max = Math.max(1, ...snap.funnel!.map((f) => f.value));
                  return snap.funnel!.map((f) => (
                    <div key={f.label} className="aiva-funnel-row">
                      <div className="aiva-funnel-head">
                        <span className="aiva-funnel-label">{f.label}</span>
                        <span className="aiva-funnel-value">
                          {f.value}
                          {f.sub ? <span className="aiva-funnel-sub"> · {f.sub}</span> : null}
                        </span>
                      </div>
                      <div className="aiva-funnel-track">
                        <div className="aiva-funnel-fill" style={{ width: `${Math.round((f.value / max) * 100)}%` }} />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          ) : null}

          {snap && snap.recommendations.length > 0 ? (
            <div className="mt-4">
              <div className="aiva-label mb-2">What it&apos;s watching</div>
              <div className="space-y-2">
                {snap.recommendations.map((r) => (
                  <div key={r.id} className="rounded-xl border border-line bg-navy-700/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-white">{r.title}</span>
                      <RiskPill risk={r.risk} />
                    </div>
                    <p className="mt-1 text-xs text-muted">{r.rationale}</p>
                    {!r.executable ? <p className="mt-1 text-xs text-warning">Disabled: {r.blockedReason || "read-only mode"}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {snap?.caveats && snap.caveats.length > 0 ? (
            <div className="mt-4">
              <div className="aiva-label mb-1">Data notes</div>
              <ul className="space-y-1">
                {snap.caveats.map((c, i) => (
                  <li key={i} className="aiva-caveat">{c}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {snap?.note ? <p className="mt-3 text-xs text-muted">{snap.note}</p> : null}
        </>
      )}

      {meta?.href ? (
        <Link href={meta.href} className="aiva-btn-primary mt-4 w-full">
          Open {meta.name} workspace
        </Link>
      ) : null}
    </div>
  );
}
