"use client";

import { Card, SectionTitle, Skeleton, useApi } from "@/components/kit";
import type { HealthReport } from "@/lib/health";

export const dynamic = "force-dynamic";

const DOT: Record<string, string> = { ok: "#16a34a", warn: "#f59e0b", down: "#dc2626", unknown: "#8b97b5" };

export default function SystemHealthPage() {
  const { data, error, loading } = useApi<{ report: HealthReport }>("/api/health");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-white">System Health</h1>
        <p className="text-sm text-muted">DB latency, cron freshness, gateway posture, codebase intelligence &amp; feature flags.</p>
      </div>

      {loading ? (
        <Skeleton lines={6} />
      ) : error ? (
        <Card><p className="text-danger">{error}</p></Card>
      ) : (
        <>
          <Card>
            <SectionTitle>Checks</SectionTitle>
            <ul className="space-y-2">
              {data!.report.checks.map((c) => (
                <li key={c.key} className="flex items-center justify-between rounded-xl border border-line bg-navy-700/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: DOT[c.status] }} />
                    <span className="text-white">{c.label}</span>
                  </div>
                  <span className="text-xs text-muted">{c.detail}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <SectionTitle sub="First release ships all action features OFF.">Feature flags</SectionTitle>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {Object.entries(data!.report.flags).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-lg border border-line bg-navy-700/30 px-3 py-2 text-xs">
                  <span className="font-mono text-muted">{k}</span>
                  <span className={typeof v === "boolean" ? (v ? "text-success" : "text-muted") : "text-white"}>{String(v)}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
