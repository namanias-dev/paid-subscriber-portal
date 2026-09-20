"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";

interface ProductRow {
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

interface PrefSubject {
  id: string;
  name: string;
  slug: string;
  available: boolean;
  raw_count: number;
  available_demand: number;
  unavailable_demand: number;
}

interface Pair {
  a: string;
  b: string;
  a_name: string;
  b_name: string;
  count: number;
  pct_of_a: number;
  pct_of_b: number;
}

interface Trio {
  ids: string[];
  names: string[];
  count: number;
}

interface Preferences {
  total_submissions: number;
  unique_respondents: number;
  subjects: PrefSubject[];
  pairs: Pair[];
  trios: Trio[];
  also_selected: Record<string, Array<{ id: string; name: string; count: number; pct: number }>>;
  trend: Array<{ date: string; submissions: number }>;
}

const SORTS = [
  { id: "most", label: "Most requested" },
  { id: "recent", label: "Recently requested" },
  { id: "coming_soon", label: "Coming Soon" },
] as const;

export default function InterestDashboard() {
  const [rows, setRows] = useState<ProductRow[] | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("most");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    fetch(`/api/admin/notes/interest?sort=${sort}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "Could not load interest");
        setRows(j.rows || []);
        setPrefs(j.preferences || null);
      })
      .catch((e) => setErr((e as Error).message));
  }, [sort]);

  const topSubject = prefs?.subjects.slice().sort((a, b) => b.raw_count - a.raw_count)[0];
  const also = topSubject ? prefs?.also_selected[topSubject.id] || [] : [];

  return (
    <div>
      <PageHeader
        title="Notes demand"
        subtitle="Student Voices preference sets plus Coming Soon title votes. Neither is paid preparation demand."
      />
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <strong>Student Voices</strong> = subjects a student said they want (one set per device).{" "}
        <strong>Title votes</strong> = “I want these notes” on a Coming Soon product.{" "}
        <Link href="/admin/notes/preparation" className="font-semibold underline">
          Preparation Queue
        </Link>{" "}
        = paid operational demand. Interest is not marketing consent.
      </div>

      {err && <p className="text-sm text-red-700">{err}</p>}

      <section className="mb-8">
        <h2 className="font-heading text-lg font-bold text-ink">Student Voices</h2>
        {!prefs ? (
          <p className="mt-3 text-sm text-muted">Loading preference intelligence…</p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Stat label="Preference submissions" value={prefs.unique_respondents} />
              <Stat label="Available-subject demand" value={prefs.subjects.reduce((s, r) => s + r.available_demand, 0)} />
              <Stat label="Unavailable-subject demand" value={prefs.subjects.reduce((s, r) => s + r.unavailable_demand, 0)} />
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Availability</th>
                    <th className="px-4 py-3">Demand</th>
                  </tr>
                </thead>
                <tbody>
                  {prefs.subjects.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-sm text-muted">
                        No subject preferences yet. The storefront poll writes here after a student saves interests.
                      </td>
                    </tr>
                  ) : (
                    prefs.subjects
                      .slice()
                      .sort((a, b) => b.raw_count - a.raw_count)
                      .map((s) => (
                        <tr key={s.id} className="border-t border-line">
                          <td className="px-4 py-3 font-semibold">{s.name}</td>
                          <td className="px-4 py-3">{s.available ? "Available now" : "Not yet purchasable"}</td>
                          <td className="px-4 py-3 tabular-nums font-semibold">{s.raw_count}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <article className="rounded-xl border border-line bg-white p-4">
                <h3 className="font-heading text-base font-bold">Top 2-subject combinations</h3>
                {prefs.pairs.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">Need multi-subject submissions before pairs appear.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {prefs.pairs.map((p) => (
                      <li key={`${p.a}-${p.b}`} className="flex justify-between gap-3">
                        <span>
                          {p.a_name} + {p.b_name}
                        </span>
                        <span className="tabular-nums text-muted">
                          {p.count} · {p.pct_of_a}% of {p.a_name}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
              <article className="rounded-xl border border-line bg-white p-4">
                <h3 className="font-heading text-base font-bold">Top 3-subject combinations</h3>
                {prefs.trios.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">Need three-subject submissions before trios appear.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {prefs.trios.map((t) => (
                      <li key={t.ids.join("-")} className="flex justify-between gap-3">
                        <span>{t.names.join(" + ")}</span>
                        <span className="tabular-nums text-muted">{t.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>

            {topSubject && also.length > 0 && (
              <article className="mt-4 rounded-xl border border-line bg-white p-4">
                <h3 className="font-heading text-base font-bold">Potential bundle opportunities</h3>
                <p className="mt-1 text-sm text-muted">
                  Students interested in <strong>{topSubject.name}</strong> also selected:
                </p>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {also.map((row) => (
                    <li key={row.id} className="flex justify-between">
                      <span>{row.name}</span>
                      <span className="tabular-nums text-muted">
                        {row.pct}% · {row.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            )}

            {prefs.trend.length > 0 && (
              <article className="mt-4 rounded-xl border border-line bg-white p-4">
                <h3 className="font-heading text-base font-bold">Submissions over time</h3>
                <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {prefs.trend.slice(-14).map((t) => (
                    <li key={t.date} className="flex justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                      <span>{t.date}</span>
                      <span className="tabular-nums font-semibold">{t.submissions}</span>
                    </li>
                  ))}
                </ul>
              </article>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="font-heading text-lg font-bold text-ink">Coming Soon title votes</h2>
        <div className="mb-4 mt-3 flex flex-wrap gap-2">
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
        {rows == null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-white p-8 text-sm text-muted">
            No title-level interest recorded yet. Coming Soon products still collect “I want these notes” votes.
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
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-heading text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
