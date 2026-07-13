"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Trophy, Search, Download, FileText, ArrowUpDown, Users, CalendarDays,
  ChevronLeft, ChevronRight, ShieldOff, BarChart3, Info, UserMinus, X, Plus, Check,
} from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { downloadLeaderboardPdf } from "@/lib/performancePdf";
import type { LeaderboardRow, BatchOption } from "@/lib/leaderboard";
import { RELIABILITY_INFO, LEADERBOARD_MIN_C, LEADERBOARD_MAX_C } from "@/lib/leaderboardConfig";

type SortKey = "reliability" | "accuracy" | "attemptRate" | "quizzes" | "quizzesAccuracy" | "name";
const PAGE_SIZE = 50;

interface QuizOption { id: string; title: string }
interface Person { id: string; name: string; phone: string | null }

interface ApiResult {
  ok: boolean;
  batchLabel: string;
  batchKey: string | null;
  quizId: string | null;
  snapshotISO: string;
  studentCount: number;
  paidCount: number;
  nonPayingCount: number;
  classAverage: number;
  reliabilityC: number;
  excludedCount: number;
  batches: BatchOption[];
  quizzes: QuizOption[];
  rows: LeaderboardRow[];
}

interface ExclusionsResult {
  ok: boolean;
  excludedStudentIds: string[];
  reliabilityC: number;
  canEdit: boolean;
  people: Person[];
}

function toCsv(rows: LeaderboardRow[]): string {
  const head = ["Rank", "Name", "Batch", "ReliabilityScore", "Quizzes", "Accuracy", "AttemptRate", "TopSubject", "WeakSubject"];
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r, i) =>
    [
      i + 1,
      r.name,
      r.batchLabel || "",
      r.hasData ? r.reliability.toFixed(1) : "",
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
  const [batchKey, setBatchKey] = useState<string>(""); // "" = All batches
  const [quizId, setQuizId] = useState<string>("");      // "" = All quizzes
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("reliability");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  // Feature 4 — info popover.
  const [infoOpen, setInfoOpen] = useState(false);

  // Feature 5 — global exclude config.
  const [excl, setExcl] = useState<ExclusionsResult | null>(null);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [cValue, setCValue] = useState<number>(3);
  const [exclOpen, setExclOpen] = useState(false);
  const [exclSearch, setExclSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => setAllowed(!!d?.ok && d?.admin?.permissions?.manage_students_leads === true))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (batchKey) params.set("batch", batchKey);
    if (quizId) params.set("quizId", quizId);
    const qs = params.toString();
    fetch(`/api/admin/quiz-performance/leaderboard${qs ? `?${qs}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d.ok ? (d as ApiResult) : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [allowed, batchKey, quizId, reloadKey]);

  useEffect(() => {
    if (!allowed) return;
    fetch("/api/admin/leaderboard/exclusions", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ExclusionsResult) => {
        if (!d?.ok) return;
        setExcl(d);
        setExcludedIds(d.excludedStudentIds);
        setCValue(d.reliabilityC);
      })
      .catch(() => setExcl(null));
  }, [allowed, reloadKey]);

  useEffect(() => { setPage(0); }, [q, sortKey, dir, batchKey, quizId]);

  const peopleById = useMemo(() => {
    const m = new Map<string, Person>();
    for (const p of excl?.people ?? []) m.set(p.id, p);
    return m;
  }, [excl]);

  const view = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = data.rows.filter((r) => {
      if (!needle) return true;
      return r.name.toLowerCase().includes(needle) || (r.phone || "").includes(needle);
    });
    list.sort((a, b) => {
      if (a.hasData !== b.hasData) return a.hasData ? -1 : 1; // no-data always last
      if (sortKey === "quizzesAccuracy") {
        return b.quizzes - a.quizzes || b.accuracy - a.accuracy || b.reliability - a.reliability || a.name.localeCompare(b.name);
      }
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

  // Chips reflect the working (possibly unsaved) admin exclude list.
  const chips = excludedIds.map((id) => peopleById.get(id)).filter((p): p is Person => !!p);
  const dirty = excl ? (excludedIds.slice().sort().join("|") !== excl.excludedStudentIds.slice().sort().join("|") || cValue !== excl.reliabilityC) : false;
  const canEdit = excl?.canEdit === true;

  const searchMatches = useMemo(() => {
    const needle = exclSearch.trim().toLowerCase();
    if (!needle) return [] as Person[];
    const already = new Set(excludedIds);
    return (excl?.people ?? [])
      .filter((p) => !already.has(p.id) && ((p.name || "").toLowerCase().includes(needle) || (p.phone || "").includes(needle)))
      .slice(0, 8);
  }, [exclSearch, excl, excludedIds]);

  function addExcluded(id: string) { setExcludedIds((prev) => (prev.includes(id) ? prev : [...prev, id])); setExclSearch(""); }
  function removeExcluded(id: string) { setExcludedIds((prev) => prev.filter((x) => x !== id)); }

  async function saveExclusions() {
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/admin/leaderboard/exclusions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludedStudentIds: excludedIds, reliabilityC: cValue }),
      });
      const d = await res.json();
      if (!res.ok || !d?.ok) throw new Error(d?.error || "Save failed");
      setReloadKey((k) => k + 1); // refetch board + config with new global list
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

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
    void downloadLeaderboardPdf({ batchLabel: data.batchLabel, snapshotISO: data.snapshotISO, studentCount: view.length, rows: view });
  }

  function toggleSort(key: Exclude<SortKey, "quizzesAccuracy">) {
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

  const quizLabel = quizId ? (data?.quizzes.find((x) => x.id === quizId)?.title ?? "Selected quiz") : "All quizzes";

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
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink2">
              <span className="inline-flex items-center gap-1.5"><Users size={14} className="opacity-60" /> {data?.studentCount ?? 0} students</span>
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className="pill pill-green tabular-nums">{data?.paidCount ?? 0} paid</span>
                <span className="pill pill-gray tabular-nums">{data?.nonPayingCount ?? 0} non-paying</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-ink2"><BarChart3 size={14} className="opacity-60" /> Quiz: {quizLabel}</span>
              {(data?.excludedCount ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1.5 pill pill-gray"><UserMinus size={13} /> {data?.excludedCount} excluded</span>
              )}
              {snapshotDate && <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} className="opacity-60" /> {snapshotDate}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={exportCsv} disabled={!data || view.length === 0} className="btn btn-secondary text-sm disabled:opacity-50"><Download size={14} /> CSV</button>
            <button onClick={exportPdf} disabled={!data || view.length === 0} className="btn btn-secondary text-sm disabled:opacity-50"><FileText size={14} /> PDF</button>
          </div>
        </div>
      </div>

      {/* Controls — batch (Feature 2), quiz (Feature 1), search, sort (Feature 3) */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select className="input min-h-[44px]" value={batchKey} onChange={(e) => setBatchKey(e.target.value)} aria-label="Filter by batch">
          <option value="">All batches</option>
          {(data?.batches ?? []).map((b) => (
            <option key={b.key} value={b.key}>{b.title} ({b.studentCount})</option>
          ))}
        </select>
        <select className="input min-h-[44px]" value={quizId} onChange={(e) => setQuizId(e.target.value)} aria-label="Filter by quiz">
          <option value="">All quizzes</option>
          {(data?.quizzes ?? []).map((qz) => (
            <option key={qz.id} value={qz.id}>{qz.title}</option>
          ))}
        </select>
        <label className="relative flex items-center">
          <Search size={15} className="pointer-events-none absolute left-3 text-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone…" className="input min-h-[44px] w-full pl-9" aria-label="Search students" />
        </label>
        <select
          className="input min-h-[44px]"
          value={sortKey === "quizzesAccuracy" ? "quizzesAccuracy" : `${sortKey}:${dir}`}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "quizzesAccuracy") { setSortKey("quizzesAccuracy"); return; }
            const [k, d] = v.split(":") as [SortKey, "asc" | "desc"];
            setSortKey(k); setDir(d);
          }}
          aria-label="Sort"
        >
          <option value="reliability:desc">Reliability Score — top</option>
          <option value="accuracy:desc">Accuracy — top first</option>
          <option value="accuracy:asc">Accuracy — weakest first</option>
          <option value="attemptRate:desc">Attempt rate — highest</option>
          <option value="quizzes:desc">Most quizzes</option>
          <option value="quizzesAccuracy">Most quizzes → then accuracy</option>
          <option value="name:asc">Name — A to Z</option>
        </select>
      </div>

      {/* Feature 5 — global exclude users manager */}
      <ExcludePanel
        open={exclOpen}
        setOpen={setExclOpen}
        canEdit={canEdit}
        chips={chips}
        searchValue={exclSearch}
        setSearchValue={setExclSearch}
        matches={searchMatches}
        onAdd={addExcluded}
        onRemove={removeExcluded}
        cValue={cValue}
        setCValue={setCValue}
        dirty={dirty}
        saving={saving}
        saveErr={saveErr}
        onSave={saveExclusions}
        classAverage={data?.classAverage ?? 0}
      />

      {/* Table */}
      {loading ? (
        <TableSkeleton />
      ) : !data || view.length === 0 ? (
        <div className="card flex flex-col items-center p-12 text-center">
          <BarChart3 size={26} className="mb-3 text-muted" aria-hidden="true" />
          <p className="font-heading text-lg font-bold">{q ? "No students match your search" : "No students in this view yet"}</p>
          <p className="mt-1 text-sm text-ink2">
            {q ? "Try a different name or phone." : quizId ? "No one in this scope has attempted the selected quiz yet." : "Once students in this batch attempt quizzes, they’ll appear here."}
          </p>
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
                  <Th className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <SortBtn label="Score" active={sortKey === "reliability"} dir={dir} onClick={() => toggleSort("reliability")} right />
                      <button
                        type="button"
                        onClick={() => setInfoOpen((o) => !o)}
                        className="ca-focus text-muted hover:text-ink"
                        aria-label="What is the Reliability Score?"
                      >
                        <Info size={13} />
                      </button>
                    </span>
                  </Th>
                  <Th className="text-right"><SortBtn label="Quizzes" active={sortKey === "quizzes"} dir={dir} onClick={() => toggleSort("quizzes")} right /></Th>
                  <Th className="text-right"><SortBtn label="Accuracy" active={sortKey === "accuracy"} dir={dir} onClick={() => toggleSort("accuracy")} right /></Th>
                  <Th className="hidden text-right sm:table-cell"><SortBtn label="Attempt%" active={sortKey === "attemptRate"} dir={dir} onClick={() => toggleSort("attemptRate")} right /></Th>
                  <Th className="hidden lg:table-cell pr-4">Strong / Weak</Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, idx) => {
                  const rank = page * PAGE_SIZE + idx + 1;
                  const top3 = (sortKey === "reliability" || sortKey === "accuracy") && dir === "desc" && r.hasData && rank <= 3;
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
                          <td className={`py-3 text-right font-extrabold tabular-nums ${accCls(r.reliability)}`}>{r.reliability.toFixed(1)}</td>
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
                        <td colSpan={5} className="py-3 pr-4 text-xs italic text-muted">no attempts yet</td>
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

      {/* Feature 4 — student-friendly Reliability Score explainer */}
      {infoOpen && <InfoModal onClose={() => setInfoOpen(false)} classAverage={data?.classAverage ?? 0} c={data?.reliabilityC ?? cValue} />}
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

function InfoModal({ onClose, classAverage, c }: { onClose: () => void; classAverage: number; c: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div className="card max-w-md p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={RELIABILITY_INFO.title}>
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-2 font-heading text-lg font-bold"><Info size={18} className="text-primary" /> {RELIABILITY_INFO.title}</p>
          <button onClick={onClose} className="ca-focus text-muted hover:text-ink" aria-label="Close"><X size={18} /></button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink2">{RELIABILITY_INFO.lead}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink2">{RELIABILITY_INFO.detail}</p>
        <div className="mt-3 rounded-lg border border-line bg-surface2/50 p-3 text-sm text-ink2">{RELIABILITY_INFO.example}</div>
        <p className="mt-3 text-xs text-muted">
          In this view we blend each student with {c} “average” quiz{c === 1 ? "" : "zes"} scored at the current class average
          {classAverage > 0 ? ` (${classAverage}%)` : ""}.
        </p>
      </div>
    </div>
  );
}

function ExcludePanel(props: {
  open: boolean; setOpen: (v: boolean) => void; canEdit: boolean;
  chips: Person[]; searchValue: string; setSearchValue: (v: string) => void;
  matches: Person[]; onAdd: (id: string) => void; onRemove: (id: string) => void;
  cValue: number; setCValue: (n: number) => void;
  dirty: boolean; saving: boolean; saveErr: string | null; onSave: () => void; classAverage: number;
}) {
  const { open, setOpen, canEdit, chips, searchValue, setSearchValue, matches, onAdd, onRemove, cValue, setCValue, dirty, saving, saveErr, onSave } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  return (
    <div className="card p-0">
      <button
        onClick={() => setOpen(!open)}
        className="ca-focus flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <UserMinus size={15} className="text-muted" /> Excluded users
          {chips.length > 0 && <span className="pill pill-gray tabular-nums">{chips.length}</span>}
        </span>
        <ChevronRight size={16} className={`text-muted transition ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-4 py-4">
          <p className="text-xs text-ink2">
            Excluded students are removed from ranking <strong>and</strong> from all aggregates (cohort size, class average, ranks)
            in every leaderboard view — a single global list. This never changes accounts, enrollments or quiz data.
          </p>

          {/* Chips */}
          <div className="flex flex-wrap gap-1.5">
            {chips.length === 0 && <span className="text-xs text-muted">No additional users excluded.</span>}
            {chips.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface2/60 py-1 pl-2.5 pr-1 text-xs">
                <span className="font-medium text-ink">{p.name}</span>
                {p.phone && <span className="text-muted">{p.phone}</span>}
                {canEdit && (
                  <button onClick={() => onRemove(p.id)} className="ca-focus rounded-full p-0.5 text-muted hover:bg-line hover:text-danger" aria-label={`Remove ${p.name}`}>
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>

          {canEdit ? (
            <>
              {/* Searchable add */}
              <div ref={boxRef} className="relative max-w-md">
                <label className="relative flex items-center">
                  <Search size={15} className="pointer-events-none absolute left-3 text-muted" aria-hidden="true" />
                  <input
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    placeholder="Add by name or phone…"
                    className="input min-h-[40px] w-full pl-9"
                    aria-label="Search students to exclude"
                  />
                </label>
                {matches.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
                    {matches.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => onAdd(p.id)}
                        className="ca-focus flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface2"
                      >
                        <span className="font-medium text-ink">{p.name}</span>
                        <span className="inline-flex items-center gap-2 text-xs text-muted">{p.phone}<Plus size={13} /></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* C tuning + save */}
              <div className="flex flex-wrap items-end gap-3 pt-1">
                <label className="text-xs text-ink2">
                  <span className="mb-1 block font-semibold">Reliability confidence (C)</span>
                  <input
                    type="number"
                    min={LEADERBOARD_MIN_C}
                    max={LEADERBOARD_MAX_C}
                    step={1}
                    value={cValue}
                    onChange={(e) => setCValue(Math.min(LEADERBOARD_MAX_C, Math.max(LEADERBOARD_MIN_C, Number(e.target.value) || 0)))}
                    className="input min-h-[40px] w-28"
                    aria-label="Reliability confidence constant C"
                  />
                </label>
                <button onClick={onSave} disabled={!dirty || saving} className="btn btn-primary text-sm disabled:opacity-50">
                  {saving ? "Saving…" : <><Check size={14} /> Save changes</>}
                </button>
                {dirty && !saving && <span className="text-xs text-amber-600">Unsaved changes</span>}
                {saveErr && <span className="text-xs text-danger">{saveErr}</span>}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted">This global list is managed by an administrator (requires “Manage settings”).</p>
          )}
        </div>
      )}
    </div>
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
