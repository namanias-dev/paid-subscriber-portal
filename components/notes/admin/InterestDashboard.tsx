"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";

interface Row {
  product_id: string;
  name: string;
  subject: string | null;
  slug: string;
  availability_mode: string;
  total: number;
  last7: number;
  last30: number;
  last_at: string | null;
}

const SORTS = [
  { id: "most", label: "Most requested" },
  { id: "recent", label: "Recently requested" },
  { id: "coming_soon", label: "Coming Soon" },
] as const;

export default function InterestDashboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("most");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    fetch(`/api/admin/notes/interest?sort=${sort}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "Could not load interest");
        setRows(j.rows || []);
      })
      .catch((e) => setErr((e as Error).message));
  }, [sort]);

  return (
    <div>
      <PageHeader
        title="Student Interest"
        subtitle="Potential demand for upcoming notes. This is not paid preparation demand."
      />
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <strong>Student Interest</strong> = people who said they want a title.{" "}
        <Link href="/admin/notes/preparation" className="font-semibold underline">
          Preparation Queue
        </Link>{" "}
        = paid operational demand. Keep them separate.
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSort(s.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${sort === s.id ? "bg-slate-900 text-white" : "border border-line bg-white"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {rows == null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white p-8 text-sm text-muted">
          No student interest recorded yet. Coming Soon titles on the storefront collect “I want these notes” votes.
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-line bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Subject / title</th>
                  <th className="px-4 py-3">Availability</th>
                  <th className="px-4 py-3">Interest</th>
                  <th className="px-4 py-3">7-day</th>
                  <th className="px-4 py-3">30-day</th>
                  <th className="px-4 py-3">Last</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.product_id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted">{r.subject || r.slug}</p>
                    </td>
                    <td className="px-4 py-3 capitalize">{r.availability_mode.replace("_", " ")}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums">{r.total}</td>
                    <td className="px-4 py-3 tabular-nums">{r.last7}</td>
                    <td className="px-4 py-3 tabular-nums">{r.last30}</td>
                    <td className="px-4 py-3 text-xs text-muted">{r.last_at ? new Date(r.last_at).toLocaleString("en-IN") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {rows.map((r) => (
              <article key={r.product_id} className="rounded-xl border border-line bg-white p-4">
                <p className="font-semibold">{r.name}</p>
                <p className="text-xs text-muted">
                  {r.subject || r.slug} · {r.availability_mode.replace("_", " ")}
                </p>
                <p className="mt-2 text-sm">
                  <span className="font-semibold tabular-nums">{r.total}</span> interested · 7d {r.last7} · 30d {r.last30}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
