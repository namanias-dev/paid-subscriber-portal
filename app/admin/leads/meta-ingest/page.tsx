"use client";

import { useCallback, useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, KpiCard } from "@/components/admin/ui";
import { formatISTDateTime } from "@/lib/dates";

interface IngestRow {
  id: string;
  leadgen_id: string;
  lead_id: string | null;
  campaign_name: string | null;
  form_name: string | null;
  platform: string | null;
  outcome: string;
  error_message: string | null;
  handler_ms: number | null;
  ingested_at: string;
  meta_created_at: string | null;
  phone_key: string | null;
  no_usable_contact: boolean;
  signature_valid: boolean;
}

interface MetaIngestReport {
  health: {
    configured: boolean;
    missing: string[];
    enabled: boolean;
    pageIdSet: boolean;
    pageTokenSet?: boolean;
    formIdsSet?: boolean;
  };
  lastReceived: string | null;
  silenceHours: number | null;
  silenceAlert: boolean;
  pendingRetry: number;
  last24h: Record<string, number>;
  recent: IngestRow[];
}

export default function MetaLeadIngestPage() {
  const { data, loading, reload } = useAdminData<MetaIngestReport>(
    "/api/admin/leads/meta-ingest",
    "report",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = useCallback(
    async (action: "reconcile" | "retry_pending") => {
      setBusy(action);
      setMsg(null);
      try {
        const res = await fetch("/api/admin/leads/meta-ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, hours: 24 }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Request failed");
        setMsg(action === "reconcile" ? JSON.stringify(json.summary) : `Retried ${json.attempted}`);
        await reload();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Failed");
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  if (loading && !data) return <LoadingBlock />;
  if (!data) {
    return (
      <div>
        <PageHeader title="Meta Lead Ads" subtitle="Ingestion observability" />
        <p className="text-sm text-muted">Could not load ingestion status.</p>
      </div>
    );
  }

  const h24 = data.last24h || {};
  const success24 = (h24.created || 0) + (h24.attached_existing || 0);
  const fail24 = (h24.failed || 0) + (h24.pending_retry || 0);

  return (
    <div>
      <PageHeader
        title="Meta Lead Ads"
        subtitle="Realtime leadgen webhook → Leads CRM · replaces Pabbly for new leads"
      />

      {data.silenceAlert && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          No Meta leads received for ~{data.silenceHours?.toFixed(0)}h. If campaigns are active,
          check App Review, Page subscription, and token health below.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Last 24h success" value={success24} tone="green" />
        <KpiCard label="Last 24h failed/retry" value={fail24} />
        <KpiCard label="Pending retry" value={data.pendingRetry} />
        <KpiCard
          label="Last received"
          value={data.lastReceived ? formatISTDateTime(data.lastReceived) : "Never"}
        />
      </div>

      <div className="mb-5 rounded-md border border-border bg-card p-4 text-sm">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Config / token health</h3>
        <p>
          Enabled: <strong>{data.health.enabled ? "yes" : "no"}</strong>
          {" · "}
          Secrets: <strong>{data.health.configured ? "complete" : "incomplete"}</strong>
          {" · "}
          Page ID: <strong>{data.health.pageIdSet ? "set" : "missing"}</strong>
          {" · "}
          Form IDs: <strong>{data.health.formIdsSet ? "set" : "missing"}</strong>
          {" · "}
          Page token:{" "}
          <strong>{data.health.pageTokenSet ? "set" : "optional"}</strong>
        </p>
        {data.health.missing.length > 0 && (
          <p className="mt-1 text-xs text-muted">Missing: {data.health.missing.join(", ")}</p>
        )}
        <p className="mt-2 text-xs text-muted">
          Webhook URL: <code className="text-[11px]">https://www.namanias.com/api/meta/leadgen-webhook</code>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run("retry_pending")}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
          >
            {busy === "retry_pending" ? "Retrying…" : "Retry pending"}
          </button>
          <button
            type="button"
            disabled={!!busy || !data.health.pageIdSet || !data.health.formIdsSet}
            onClick={() => run("reconcile")}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {busy === "reconcile" ? "Reconciling…" : "Reconcile last 24h"}
          </button>
        </div>
        {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Ingested</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Campaign</th>
              <th className="px-3 py-2">Form</th>
              <th className="px-3 py-2">ms</th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {(data.recent || []).map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {formatISTDateTime(r.ingested_at)}
                </td>
                <td className="px-3 py-2 text-xs font-medium">{r.outcome}</td>
                <td className="px-3 py-2 text-xs">{r.campaign_name || "—"}</td>
                <td className="px-3 py-2 text-xs">{r.form_name || "—"}</td>
                <td className="px-3 py-2 text-xs">{r.handler_ms ?? "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {r.lead_id ? (
                    <a className="underline" href={`/admin/leads?lead=${r.lead_id}`}>
                      open
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-[220px] truncate px-3 py-2 text-xs text-muted" title={r.error_message || ""}>
                  {r.error_message || "—"}
                </td>
              </tr>
            ))}
            {!data.recent?.length && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">
                  No ingestions yet. Complete Meta dashboard setup, then submit a test lead.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
