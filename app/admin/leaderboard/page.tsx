"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Trophy, Search, Download, FileText, ArrowUpDown, Users, CalendarDays,
  ChevronLeft, ChevronRight, ShieldOff, BarChart3,
} from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { downloadLeaderboardPdf } from "@/lib/performancePdf";
import type { LeaderboardRow, BatchOption } from "@/lib/leaderboard";

type SortKey = "accuracy" | "quizzes" | "attemptRate" | "name";
const PAGE_SIZE = 50;

interface ApiResult {
  ok: boolean;
  batchLabel: string;
  courseId: string | null;
  snapshotISO: string;
  studentCount: number;
  batches: BatchOption[];
  rows: LeaderboardRow[];
}

function toCsv(rows: LeaderboardRow[]): string {
  const head = ["Rank", "Name", "Batch", "Quizzes", "Accuracy", "AttemptRate", "TopSubject", "WeakSubject"];
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r, i) =>
    [
      i + 1,
      r.name,
      r.batchLabel || "",
      r.hasData ? r.quizzes : "",
      r.hasData ? `${r.accuracy}%` : "no attempts",
      r.hasData ? `${r.attemptRate}%` : "",
      r.hasData && r.topSubject ? `${r.topSubject.label} (${r.topSubject.accuracy}%)` : "",
      r.hasData && r.weakSubject ? `${r.weakSubject.label} (${r.weakSubject.accuracy}%)` : "",
    ].map(esc).join(","),
  );
  return [head.join(","), ...body].join("\n");
}

export default function LeaderboardPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApiResult | null>(null);
  const [courseId, setCourseId] = useState<string>(""); // "" = All batches
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("accuracy");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => setAllowed(!!d?.ok && d?.admin?.permissions?.manage_students_leads === true))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    fetch(`/api/admin/quiz-performance/leaderboard${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d.ok ? (d as ApiResult) : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [allowed, courseId]);

  useEffect(() => { setPage(0); }, [q, sortKey, dir, courseId]);

  const view = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = data.rows.filter((r) => (needle ? r.name.toLowerCase().includes(needle) : true));
    list.sort((a, b) => {
      if (a.hasData !== b.hasData) return a.hasData ? -1 : 1; // no-data always last
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, q, sortKey, dir]);

  const pageRows = view.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(view.length / PAGE_SIZE));

  const snapshotDate = data ? new Date(data.snapshotISO).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "";

  function exportCsv() {
    if (!data) return;
    const blob = new Blob([toCsv(view)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leaderboard-${(data.batchLabel || "all").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    if (!data) return;
    downloadLeaderboardPdf({ batchLabel: data.batchLabel, snapshotISO: data.snapshotISO, studentCount: view.length, rows: view });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setDir(key === "name" ? "asc" : "desc"); }
  }

  if (allowed === null) return <div className="space-y-4"><LoadingBlock /><LoadingBlock /></div>;
  if (!allowed) {
    return (
      <div className="card flex flex-col items-center p-10 text-center">
        <ShieldOff size={26} className="mb-3 text-danger" aria-hidden="true" />
        <p className="font-heading text-lg font-bold">You don&apos;t have access to the leaderboard</p>
        <p className="mt-1 text-sm text-ink2">This view requires the &ldquo;Manage students, leads &amp; enrollments&rdquo; permission.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-16">
      {/* Header — screenshot-ready */}
      <div className="card relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/5 blur-2xl" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ca-gold,#b8860b)]">
              <Trophy size={14} aria-hidden="true" /> Performance Leaderboard
            </p>
            <h1 className="mt-1 font-heading text-2xl font-extrabold leading-tight">{data?.batchLabel || "All batches"}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink2">
              <span className="inline-flex items-center gap-1.5"><Users size={14} className="opacity-60" /> {data?.studentCount ?? 0} students</span>
              {snapshotDate && <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} className="opacity-60" /> {snapshotDate}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={exportCsv} disabled={!data || view.length === 0} className="btn btn-secondary text-sm disabled:opacity-50"><Download size={14} /> CSV</button>
            <button onClick={exportPdf} disabled={!data || view.length === 0} className="btn btn-secondary text-sm disabled:opacity-50"><FileText size={14} /> PDF</button>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select className="input min-h-[44px]" value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Filter by batch">
          <option value="">All batches</option>
          {(data?.batches ?? []).map((b) => (
            <option key={b.courseId} value={b.courseId}>{b.title} ({b.studentCount})</option>
          ))}
        </select>
        <label className="relative flex items-center sm:col-span-1 lg:col-span-2">
          <Search size={15} className="pointer-events-none absolute left-3 text-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students in this view…" className="input min-h-[44px] w-full pl-9" aria-label="Search students" />
        </label>
        <select className="input min-h-[44px]" value={`${sortKey}:${dir}`} onChange={(e) => { const [k, d] = e.target.value.split(":") as [SortKey, "asc" | "desc"]; setSortKey(k); setDir(d); }} aria-label="Sort">
          <option value="accuracy:desc">Accuracy — top first</option>
          <option value="accuracy:asc">Accuracy — weakest first</option>
          <option value="quizzes:desc">Quizzes — most</option>
          <option value="attemptRate:desc">Attempt rate — highest</option>
          <option value="name:asc">Name — A to Z</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton />
      ) : !data || view.length === 0 ? (
        <div className="card flex flex-col items-center p-12 text-center">
          <BarChart3 size={26} className="mb-3 text-muted" aria-hidden="true" />
          <p className="font-heading text-lg font-bold">{q ? "No students match your search" : "No students in this view yet"}</p>
          <p className="mt-1 text-sm text-ink2">{q ? "Try a different name." : "Once students in this batch attempt quizzes, they’ll appear here."}</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface2/50 text-left text-xs uppercase tracking-wide text-muted">
                  <Th className="w-12 pl-4">#</Th>
                  <Th><SortBtn label="Student" active={sortKey === "name"} dir={dir} onClick={() => toggleSort("name")} /></Th>
                  <Th className="hidden md:table-cell">Batch</Th>
                  <Th className="text-right"><SortBtn label="Quizzes" active={sortKey === "quizzes"} dir={dir} onClick={() => toggleSort("quizzes")} right /></Th>
                  <Th className="text-right"><SortBtn label="Accuracy" active={sortKey === "accuracy"} dir={dir} onClick={() => toggleSort("accuracy")} right /></Th>
                  <Th className="hidden text-right sm:table-cell"><SortBtn label="Attempt%" active={sortKey === "attemptRate"} dir={dir} onClick={() => toggleSort("attemptRate")} right /></Th>
                  <Th className="hidden lg:table-cell pr-4">Strong / Weak</Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, idx) => {
                  const rank = page * PAGE_SIZE + idx + 1;
                  const top3 = sortKey === "accuracy" && dir === "desc" && r.hasData && rank <= 3;
                  return (
                    <tr
                      key={r.studentId}
                      onClick={() => router.push(`/admin/students/${r.studentId}/performance`)}
                      onKeyDown={(e) => { if (e.key === "Enter") router.push(`/admin/students/${r.studentId}/performance`); }}
                      tabIndex={0}
                      role="link"
                      title={`Open ${r.name}'s performance`}
                      className={`ca-focus cursor-pointer border-b border-line transition hover:bg-surface2/60 ${top3 ? "bg-[rgba(212,175,55,0.06)]" : ""}`}
                    >
                      <td className="py-3 pl-4">
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold ${top3 ? "bg-gradient-to-r from-[#f4c84a] to-[#b8860b] text-[#1a1304]" : "text-muted"}`}>{rank}</span>
                      </td>
                      <td className="py-3 font-semibold text-ink">{r.name}</td>
                      <td className="hidden py-3 text-ink2 md:table-cell">{r.batchLabel || "—"}</td>
                      {r.hasData ? (
                        <>
                          <td className="py-3 text-right tabular-nums">{r.quizzes}</td>
                          <td className={`py-3 text-right font-bold tabular-nums ${accCls(r.accuracy)}`}>{r.accuracy}%</td>
                          <td className="hidden py-3 text-right tabular-nums sm:table-cell">{r.attemptRate}%</td>
                          <td className="hidden py-3 pr-4 lg:table-cell">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                              {r.topSubject && <span className="pill pill-green">{r.topSubject.label} {r.topSubject.accuracy}%</span>}
                              {r.weakSubject && r.weakSubject.label !== r.topSubject?.label && <span className="pill pill-red">{r.weakSubject.label} {r.weakSubject.accuracy}%</span>}
                            </div>
                          </td>
                        </>
                      ) : (
                        <td colSpan={4} className="py-3 pr-4 text-xs italic text-muted">no attempts yet</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
              <span className="text-muted">Showing {page * PAGE_SIZE + 1}–{Math.min(view.length, (page + 1) * PAGE_SIZE)} of {view.length}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn btn-secondary px-2 py-1.5 text-sm disabled:opacity-40"><ChevronLeft size={15} /></button>
                <span className="text-xs text-ink2">Page {page + 1} / {pageCount}</span>
                <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="btn btn-secondary px-2 py-1.5 text-sm disabled:opacity-40"><ChevronRight size={15} /></button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function accCls(a: number) {
  return a >= 75 ? "text-success" : a >= 40 ? "text-amber-600" : "text-danger";
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 font-semibold ${className}`}>{children}</th>;
}

function SortBtn({ label, active, dir, onClick, right }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; right?: boolean }) {
  return (
    <button onClick={onClick} className={`ca-focus inline-flex items-center gap-1 ${right ? "flex-row-reverse" : ""} ${active ? "text-ink" : "hover:text-ink"}`}>
      {label} <ArrowUpDown size={12} className={active ? "opacity-100" : "opacity-40"} />
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="card p-0" aria-busy="true">
      <div className="border-b border-line bg-surface2/50 px-4 py-3"><div className="skeleton animate-shimmer h-4 w-40" /></div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3.5">
          <div className="skeleton animate-shimmer h-6 w-6 rounded-full" />
          <div className="skeleton animate-shimmer h-4 w-40" />
          <div className="ml-auto skeleton animate-shimmer h-4 w-16" />
          <div className="skeleton animate-shimmer h-4 w-12" />
        </div>
      ))}
    </div>
  );
}
