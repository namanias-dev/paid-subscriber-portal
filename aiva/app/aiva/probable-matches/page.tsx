"use client";

import Link from "next/link";
import { useApi, Card, SectionTitle, Skeleton, inr } from "@/components/kit";

type ProbableMatch = {
  name: string;
  registeredPhoneMasked: string;
  enrollmentPhoneMasked: string;
  webinar: { title: string; date: string | null } | null;
  batch: string | null;
  enrollmentStatus: string;
  amountPaid: number;
  outstanding: number;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

export default function ProbableMatchesPage() {
  const { data, loading, error } = useApi<{ total: number; rows: ProbableMatch[] }>("/api/probable-matches");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <SectionTitle sub="Webinar registrants matched to an enrollment by NAME but with a different phone number. These are UNCONFIRMED and are never counted in the hard conversion rate. Eyeball each; act in the portal if correct.">
          Probable matches — review ({data?.total ?? 0})
        </SectionTitle>

        <div className="mb-3">
          <span className="aiva-tag aiva-tag-warn">Read-only · AIVA cannot confirm or merge these</span>
        </div>

        {loading ? (
          <Skeleton lines={4} />
        ) : error ? (
          <p className="text-sm text-danger">Could not load: {error}</p>
        ) : (data?.rows || []).length === 0 ? (
          <p className="text-sm text-muted">No probable matches.</p>
        ) : (
          <div className="space-y-2">
            {data!.rows.map((r, i) => (
              <div key={i} className="aiva-drill-row">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{r.name}</span>
                  <span className="aiva-tag aiva-tag-warn">Unconfirmed</span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-muted">
                  <div>Registered phone: <span className="text-ink">{r.registeredPhoneMasked}</span></div>
                  <div>Enrollment phone: <span className="text-ink">{r.enrollmentPhoneMasked}</span></div>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {r.webinar ? <span className="aiva-tag">Webinar: {r.webinar.title} · {fmtDate(r.webinar.date)}</span> : null}
                  {r.batch ? <span className="aiva-tag">Batch: {r.batch}</span> : null}
                  <span className="aiva-tag">{r.enrollmentStatus} · paid {inr(r.amountPaid)}{r.outstanding > 0 ? ` · due ${inr(r.outstanding)}` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <Link href="/aiva" className="aiva-btn-ghost mt-4 inline-block px-3 py-1.5 text-xs">← Back to Command Center</Link>
      </Card>
    </div>
  );
}
