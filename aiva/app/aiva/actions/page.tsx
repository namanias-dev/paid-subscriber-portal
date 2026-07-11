"use client";

import { Card, RiskPill, SectionTitle, Skeleton, useApi } from "@/components/kit";

type ToolRow = { name: string; risk: "green" | "amber" | "red"; readonly: boolean; implemented: boolean; description: string; available: boolean; blockedReason?: string };

export const dynamic = "force-dynamic";

export default function ActionsPage() {
  const { data, error, loading } = useApi<{ tools: ToolRow[] }>("/api/tools");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-white">Action Catalog</h1>
        <p className="text-sm text-muted">The complete allowlist of tools AIVA agents may use. No arbitrary SQL, refunds, or bulk sends exist.</p>
      </div>
      {loading ? (
        <Skeleton lines={6} />
      ) : error ? (
        <Card><p className="text-danger">{error}</p></Card>
      ) : (
        <div className="space-y-2">
          {data!.tools.map((t) => (
            <Card key={t.name}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-sm font-semibold text-white">{t.name}</div>
                  <div className="text-sm text-muted">{t.description}</div>
                  {!t.available && t.blockedReason ? <div className="mt-1 text-xs text-warning">🔒 {t.blockedReason}</div> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <RiskPill risk={t.risk} />
                  <span className={`aiva-chip ${t.available ? "border-success/50 text-success" : "border-warning/50 text-warning"}`}>
                    {t.available ? "available" : "disabled"}
                  </span>
                  <span className="aiva-chip border-line text-muted">{t.readonly ? "read-only" : "mutating"}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
