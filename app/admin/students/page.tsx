"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Search, Users } from "lucide-react";
import { PageHeader, LoadingBlock, KpiCard } from "@/components/admin/ui";
import PeopleTabs from "@/components/admin/people/PeopleTabs";
import SourcePill, { lookupLeadAttr, type LeadAttrStamp } from "@/components/admin/SourcePill";
import CourseFeesStrip from "@/components/admin/students/CourseFeesStrip";
import StatusPill, { statusOf } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatINR } from "@/lib/dates";
import type { Student } from "@/lib/types";

interface Summary {
  courseCount: number;
  webinarCount: number;
  labels: string[];
  courseSlugs: string[];
  courseIds: string[];
  webinarIds: string[];
  totalPaid: number;
  totalDue: number;
  paymentStatus: "fully_paid" | "partial" | "outstanding" | "free";
  lastActivity: string;
  isCustomer: boolean;
}

interface Catalog {
  courses: { slug: string; title: string }[];
  webinars: { id: string; title: string }[];
}

interface ApiResponse {
  ok: boolean;
  students: Student[];
  summaries: Record<string, Summary>;
  catalog: Catalog;
  stats: { total: number; activeNow: number; expiringSoon: number; totalRevenue: number };
  /** Canonical People-area finance (course-fee scope), matches Fees & EMI exactly. */
  finance?: { courseFeesCollected: number; courseFeesOutstanding: number; webinarReceipts: number };
  /** Read-only phone -> marketing attribution; absent for legacy environments. */
  leadAttrByPhone?: Record<string, LeadAttrStamp>;
}

const EMPTY_SUMMARY: Summary = {
  courseCount: 0,
  webinarCount: 0,
  labels: [],
  courseSlugs: [],
  courseIds: [],
  webinarIds: [],
  totalPaid: 0,
  totalDue: 0,
  paymentStatus: "free",
  lastActivity: "",
  isCustomer: false,
};

type SortKey = "latest" | "oldest" | "balance" | "paid" | "name";

const PAYMENT_LABELS: Record<Summary["paymentStatus"], string> = {
  fully_paid: "Fully paid",
  partial: "Partial",
  outstanding: "Outstanding",
  free: "Free",
};

const PAYMENT_PILL: Record<Summary["paymentStatus"], string> = {
  fully_paid: "pill-green",
  partial: "pill-amber",
  outstanding: "pill-red",
  free: "pill-gray",
};

export default function StudentsAdmin() {
  const { toast } = useToast();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [q, setQ] = useState("");
  const [enrollType, setEnrollType] = useState("all");
  const [payStatus, setPayStatus] = useState("all");
  const [accessStatus, setAccessStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("latest");

  const reload = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/students")
      .then((r) => r.json())
      .then((d: ApiResponse) => setData(d?.ok ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function sync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/students/backfill", { method: "POST" });
      const j = await res.json();
      if (j?.ok) {
        const r = j.result;
        toast(
          r.studentsCreated > 0
            ? `Synced ${r.studentsCreated} paying student${r.studentsCreated === 1 ? "" : "s"} into the list.`
            : "All paying students are already in the list.",
          "success"
        );
        reload();
      } else {
        toast(j?.error || "Sync failed", "error");
      }
    } catch {
      toast("Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function action(id: string, act: string, days?: number) {
    await fetch(`/api/admin/students/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: act, days }),
    });
    toast("Updated", "success");
    reload();
  }

  const students = data?.students ?? [];
  const summaries = data?.summaries ?? {};
  const catalog = data?.catalog ?? { courses: [], webinars: [] };
  const leadAttrByPhone = data?.leadAttrByPhone ?? {};

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = students
      .map((s) => ({ s, sum: summaries[s.id] ?? EMPTY_SUMMARY }))
      .filter(({ s, sum }) => {
        if (term && !`${s.name} ${s.phone} ${s.access_code} ${s.email || ""}`.toLowerCase().includes(term))
          return false;

        if (enrollType === "course" && sum.courseCount === 0) return false;
        if (enrollType === "webinar" && sum.webinarCount === 0) return false;
        if (enrollType.startsWith("course:") && !sum.courseSlugs.includes(enrollType.slice(7))) return false;
        if (enrollType.startsWith("webinar:") && !sum.webinarIds.includes(enrollType.slice(8))) return false;

        if (payStatus !== "all" && sum.paymentStatus !== payStatus) return false;

        if (accessStatus !== "all" && statusOf(s.expiry_date, s.is_active) !== accessStatus) return false;

        return true;
      });

    list.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return new Date(a.sum.lastActivity || a.s.created_at).getTime() - new Date(b.sum.lastActivity || b.s.created_at).getTime();
        case "balance":
          return b.sum.totalDue - a.sum.totalDue;
        case "paid":
          return b.sum.totalPaid - a.sum.totalPaid;
        case "name":
          return a.s.name.localeCompare(b.s.name);
        case "latest":
        default:
          return new Date(b.sum.lastActivity || b.s.created_at).getTime() - new Date(a.sum.lastActivity || a.s.created_at).getTime();
      }
    });
    return list;
  }, [students, summaries, q, enrollType, payStatus, accessStatus, sort]);

  if (loading) return <LoadingBlock />;

  const stats = data?.stats;
  // "Collected" = COURSE FEES only, from the canonical server figure (deriveCollections
  // over confirmed enrollments) so it EQUALS the Fees & EMI screen exactly. Fall back to
  // the course-fee subset of the summaries only if the server field is unavailable.
  const courseFeesCollected =
    data?.finance?.courseFeesCollected ?? Object.values(summaries).reduce((a, s) => a + s.totalPaid, 0);
  const courseFeesOutstanding =
    data?.finance?.courseFeesOutstanding ?? Object.values(summaries).reduce((a, s) => a + s.totalDue, 0);
  const webinarReceipts = data?.finance?.webinarReceipts ?? 0;

  return (
    <div>
      <PageHeader
        title="Students & Enrollments"
        subtitle="Operational lens — find & manage a person: identity, contact, enrollments & access. For cohort money & seats, use Fees & EMI."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={sync}
              disabled={syncing}
              className="btn btn-secondary text-sm"
              title="Pull any paying students (online/offline) into this list"
            >
              <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
              <span className="ml-1.5">{syncing ? "Syncing…" : "Sync paying students"}</span>
            </button>
            <Link href="/admin/students/new" className="btn btn-primary text-sm">+ Add Student</Link>
          </div>
        }
      />
      <PeopleTabs active="students" />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total students" value={String(stats?.total ?? students.length)} tone="blue" />
        <KpiCard label="Active now" value={String(stats?.activeNow ?? 0)} tone="green" />
        <KpiCard
          label="Course Fees Collected"
          value={formatINR(courseFeesCollected)}
          tone="amber"
          hint="Matches Fees & EMI"
          title="Course Fees Collected — course-enrollment fees received (same source as Fees & EMI; these two screens match exactly). Excludes webinars & other products."
        />
        <KpiCard
          label="Course Fees Outstanding"
          value={formatINR(courseFeesOutstanding)}
          tone="red"
          hint="Course balances"
          title="Course-enrollment fees still owed = total course fees − Course Fees Collected. Matches Fees & EMI."
        />
      </div>
      {webinarReceipts > 0 && (
        <p className="-mt-2 mb-5 px-1 text-xs text-muted">
          Other receipts (webinars): <span className="font-semibold text-ink2">{formatINR(webinarReceipts)}</span> — recorded separately in{" "}
          <Link href="/admin/payments" className="text-primary hover:underline">Payments &amp; Finance</Link>. The headline “Course Fees Collected” counts course fees only.
        </p>
      )}

      {/* Finance-lens deep link — same source as Course EMI & Seats (numbers match exactly). */}
      <CourseFeesStrip />

      {/* Filters */}
      <div className="card mb-4 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, phone or login code"
              className="input w-full pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
            <select value={enrollType} onChange={(e) => setEnrollType(e.target.value)} className="input min-w-0 text-sm">
              <option value="all">All enrollments</option>
              <option value="course">Course students</option>
              <option value="webinar">Webinar registrants</option>
              {catalog.courses.length > 0 && (
                <optgroup label="Specific course">
                  {catalog.courses.map((c) => (
                    <option key={c.slug} value={`course:${c.slug}`}>{c.title}</option>
                  ))}
                </optgroup>
              )}
              {catalog.webinars.length > 0 && (
                <optgroup label="Specific webinar">
                  {catalog.webinars.map((w) => (
                    <option key={w.id} value={`webinar:${w.id}`}>{w.title}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <select value={payStatus} onChange={(e) => setPayStatus(e.target.value)} className="input min-w-0 text-sm">
              <option value="all">Any payment</option>
              <option value="fully_paid">Fully paid</option>
              <option value="partial">Partial (EMI/seat)</option>
              <option value="outstanding">Outstanding balance</option>
              <option value="free">Free</option>
            </select>
            <select value={accessStatus} onChange={(e) => setAccessStatus(e.target.value)} className="input min-w-0 text-sm">
              <option value="all">Any access</option>
              <option value="active">Active</option>
              <option value="expiring">Expiring</option>
              <option value="expired">Expired</option>
              <option value="lifetime">Lifetime</option>
              <option value="revoked">Revoked</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="input min-w-0 text-sm">
              <option value="latest">Latest first</option>
              <option value="oldest">Oldest first</option>
              <option value="balance">Balance (high→low)</option>
              <option value="paid">Total paid (high→low)</option>
              <option value="name">Name (A→Z)</option>
            </select>
          </div>
        </div>
        <p className="mt-2 px-1 text-xs text-muted">
          {rows.length} student{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Users size={28} className="text-muted" />
          <p className="font-medium text-ink">No students match these filters</p>
          <p className="text-sm text-muted">Try clearing filters, or run “Sync paying students”.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  {["Student", "Enrollments", "Money", "Valid till", "Status", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, sum }) => (
                  <tr key={s.id} className="border-b border-line last:border-0 hover:bg-surface2">
                    <td className="px-4 py-3">
                      <Link href={`/admin/students/${s.id}`} className="font-medium text-ink hover:text-primary hover:underline">
                        {s.name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        <span>{s.phone}</span>
                        <span className="font-mono text-primary">{s.access_code}</span>
                      </div>
                      {(() => {
                        const attr = lookupLeadAttr(leadAttrByPhone, s.phone);
                        if (!attr?.channel) return null;
                        return (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <SourcePill attr={attr} size="compact" />
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <EnrollmentCell sum={sum} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <MoneyCell sum={sum} />
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-ink2">
                      {sum.isCustomer && !s.expiry_date ? "—" : s.expiry_date ? formatDate(s.expiry_date) : "∞ Lifetime"}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusPill expiry={s.expiry_date} isActive={s.is_active} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-3 text-xs">
                        <Link href={`/admin/students/${s.id}`} className="font-semibold text-primary">View</Link>
                        {!sum.isCustomer && (
                          <>
                            <button onClick={() => action(s.id, "extend", 30)} className="text-ink2 hover:text-primary">+30d</button>
                            <button onClick={() => action(s.id, "revoke")} className="text-danger">Revoke</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {rows.map(({ s, sum }) => (
              <Link key={s.id} href={`/admin/students/${s.id}`} className="card block p-4 active:bg-surface2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{s.name}</p>
                    <p className="mt-0.5 text-xs text-muted">{s.phone} · <span className="font-mono text-primary">{s.access_code}</span></p>
                    {(() => {
                      const attr = lookupLeadAttr(leadAttrByPhone, s.phone);
                      if (!attr?.channel) return null;
                      return (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <SourcePill attr={attr} size="compact" />
                        </div>
                      );
                    })()}
                  </div>
                  <StatusPill expiry={s.expiry_date} isActive={s.is_active} />
                </div>
                <div className="mt-3"><EnrollmentCell sum={sum} /></div>
                <div className="mt-2"><MoneyCell sum={sum} /></div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EnrollmentCell({ sum }: { sum: Summary }) {
  if (sum.labels.length === 0) {
    return <span className="text-xs text-muted">No enrollments</span>;
  }
  const shown = sum.labels.slice(0, 2);
  const extra = sum.labels.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((l, i) => (
        <span key={i} className="rounded-md bg-surface2 px-2 py-0.5 text-xs text-ink2">{l}</span>
      ))}
      {extra > 0 && <span className="text-xs text-muted">+{extra} more</span>}
    </div>
  );
}

function MoneyCell({ sum }: { sum: Summary }) {
  if (sum.totalPaid === 0 && sum.totalDue === 0) {
    return <span className="text-xs text-muted">No payments</span>;
  }
  return (
    <div className="text-xs">
      <span className="font-semibold text-ink">{formatINR(sum.totalPaid)} paid</span>
      {sum.totalDue > 0 && <span className="text-danger"> · {formatINR(sum.totalDue)} balance</span>}
      <span className={`pill ${PAYMENT_PILL[sum.paymentStatus]} ml-2`}>{PAYMENT_LABELS[sum.paymentStatus]}</span>
    </div>
  );
}
