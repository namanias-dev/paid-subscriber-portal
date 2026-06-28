"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Check,
  ShieldOff,
  ShieldCheck,
  CalendarPlus,
  Pencil,
  GraduationCap,
  Video,
  Receipt,
  Activity,
  Phone,
  Mail,
  KeyRound,
  Download,
  History,
  Plus,
  Wallet,
  Repeat,
  SlidersHorizontal,
  CalendarClock,
  Ban,
  XCircle,
} from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import JourneyTimeline from "@/components/admin/JourneyTimeline";
import SendSmsButton from "@/components/admin/sms/SendSmsButton";
import StatusPill, { statusOf } from "@/components/ui/StatusPill";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatISTDate, formatISTDateTime, isoToISTInput } from "@/lib/dates";
import { resolveEmiConfig, payInFullTotal, planCourseEnrollment, installmentStatus, deriveEnrollment } from "@/lib/installments";
import { downloadReceiptPdf, type ReceiptContact } from "@/lib/receiptPdf";
import type { Student, PaymentReceipt, Course, Webinar, InstallmentItem, PaymentPlan } from "@/lib/types";

const PLAN_LABEL: Record<PaymentPlan, string> = {
  FULL: "Full payment",
  EMI: "EMI",
  CUSTOM_INSTALLMENTS: "Custom installments",
};

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm focus:border-primary focus:outline-none";
const METHODS = ["Cash", "Bank Transfer", "Offline UPI"];

// ---------------------------------------------------------------- types
interface CourseCard {
  id: string;
  title: string;
  slug: string | null;
  batch: string | null;
  plan: string;
  status: string;
  total: number;
  paid: number;
  remaining: number;
  progressPct: number;
  hasOverdue: boolean;
  nextDue: { label: string; amount: number; due: string | null } | null;
  createdAt: string;
  source: "course" | "legacy";
  unpaid: { kind: "seat" | "installment" | "full"; no: number; label: string; amount: number; due: string | null }[];
  paymentPlan?: PaymentPlan;
  installmentCount?: number;
  schedule?: InstallmentItem[];
  previousPlan?: PaymentPlan | null;
  planChangedAt?: string | null;
  planChangedReason?: string | null;
  planHistory?: { id: string; oldPlan: string | null; newPlan: string | null; oldOutstanding: number; newOutstanding: number; reason: string | null; changedBy: string | null; createdAt: string }[];
}
interface WebinarRow { id: string; title: string; datetime: string | null; paid: boolean; amount: number | null; status: string }
interface LedgerRow { id: string; date: string; amount: number; type: string; label: string; method: string; reference: string | null; receiptNo: string | null }
interface RecentAttempt { attemptId: string; slug: string; title: string; score: number; max_score: number; accuracy: number; submitted_at: string | null }
interface Profile {
  student: Student;
  buyerCode: string | null;
  courses: CourseCard[];
  webinars: WebinarRow[];
  ledger: LedgerRow[];
  receipts: PaymentReceipt[];
  contact: ReceiptContact;
  totals: { totalPaid: number; outstanding: number; nextDue: { label: string; amount: number; due: string | null; course: string } | null };
  performance: {
    totalAttempts: number;
    avgAccuracy: number;
    avgScorePct: number;
    bestPct: number;
    lastActive: string | null;
    streak: number;
    recent: RecentAttempt[];
    trend: number[];
  };
  accessLogs: { action: string; timestamp: string }[];
}

// ---------------------------------------------------------------- helpers
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function CopyChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch { /* ignore */ }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-xs text-primary transition hover:bg-surface2"
      aria-label={`Copy ${label}`}
    >
      {value}
      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} className="opacity-60" />}
    </button>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 120, h = 32, max = 100;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (Math.max(0, Math.min(max, v)) / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Card({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-heading text-base font-bold">
          <span className="text-primary">{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

// ---------------------------------------------------------------- page
export default function StudentProfilePage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [modal, setModal] = useState<null | "edit" | "enroll" | "webinar" | "pay" | "changePlan" | "managePlan">(null);
  const [showJourney, setShowJourney] = useState(false);
  const [payCourse, setPayCourse] = useState<CourseCard | null>(null);
  const [planCourse, setPlanCourse] = useState<CourseCard | null>(null);
  const [catalog, setCatalog] = useState<{ courses: Course[]; webinars: Webinar[] } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/students/${params.id}`)
      .then((r) => r.json())
      .then((d) => setProfile(d.ok ? d.profile : null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  function ensureCatalog() {
    if (catalog) return;
    Promise.all([
      fetch("/api/admin/courses").then((r) => r.json()),
      fetch("/api/admin/webinars").then((r) => r.json()),
    ]).then(([c, w]) => setCatalog({
      courses: (c.courses || []).filter((x: Course) => x.status === "published" && x.active !== false),
      webinars: (w.webinars || []).filter((x: Webinar) => x.active !== false),
    })).catch(() => setCatalog({ courses: [], webinars: [] }));
  }

  async function postAction(path: string, body: Record<string, unknown>, okMsg: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/students/${params.id}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) { toast(okMsg, "success"); setModal(null); load(); return true; }
      toast(data.error || "Failed", "error");
      return false;
    } catch { toast("Network error", "error"); return false; }
    finally { setBusy(false); }
  }

  // Raw POST that returns the JSON so a modal can manage its own inline errors /
  // re-confirm flow (used by Change Plan + installment actions).
  async function rawPost(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
    try {
      const res = await fetch(`/api/admin/students/${params.id}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch { return { ok: false, error: "Network error" }; }
  }

  async function act(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/students/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) { toast(okMsg, "success"); load(); }
      else toast(data.error || "Failed", "error");
    } catch { toast("Network error", "error"); }
    finally { setBusy(false); }
  }

  async function downloadReceipt(receiptNo: string) {
    if (!profile) return;
    const r = profile.receipts.find((x) => x.receipt_no === receiptNo);
    if (!r) { toast("Receipt not found", "error"); return; }
    try { await downloadReceiptPdf(r, profile.contact); }
    catch { toast("Could not generate PDF", "error"); }
  }

  if (loading) return <div className="space-y-4"><LoadingBlock /><LoadingBlock /></div>;
  if (!profile) {
    return (
      <div className="card p-10 text-center">
        <p className="text-ink2">Student not found.</p>
        <Link href="/admin/students" className="btn btn-secondary mt-4">← Back to students</Link>
      </div>
    );
  }

  const s = profile.student;
  const status = statusOf(s.expiry_date, s.is_active);
  const revoked = !s.is_active;
  const tone: Record<string, string> = { active: "ring-success/40", expiring: "ring-warning/50", expired: "ring-danger/50", lifetime: "ring-saffron/50", revoked: "ring-danger/50" };

  return (
    <div className="space-y-5 pb-16">
      <Link href="/admin/students" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
        <ArrowLeft size={15} /> Students & Enrollments
      </Link>

      {/* ---------------- HEADER ---------------- */}
      <div className="card relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/5 blur-2xl" />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0a1a3f] to-[#15326b] font-heading text-xl font-extrabold text-[#f4c84a] ring-2 ring-offset-2 ring-offset-[var(--surface)] ${tone[status]}`}>
            {initialsOf(s.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="font-heading text-2xl font-extrabold leading-tight">{s.name}</h1>
              <StatusPill expiry={s.expiry_date} isActive={s.is_active} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink2">
              <span className="inline-flex items-center gap-1.5"><Phone size={14} className="opacity-60" />{s.phone}</span>
              {s.email && <span className="inline-flex items-center gap-1.5"><Mail size={14} className="opacity-60" />{s.email}</span>}
              <span className="inline-flex items-center gap-1.5 uppercase"><GraduationCap size={14} className="opacity-60" />{s.plan}</span>
              <SendSmsButton phone={s.phone} name={s.name} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-muted"><KeyRound size={13} /> Access</span>
              <CopyChip value={s.access_code} label="access code" />
              {profile.buyerCode && (<><span className="text-muted">Portal</span><CopyChip value={profile.buyerCode} label="portal login code" /></>)}
            </div>
            <p className="mt-3 text-sm">
              <span className="text-muted">Valid till: </span>
              <span className="font-semibold">{s.expiry_date ? formatISTDate(s.expiry_date) : "Lifetime ∞"}</span>
            </p>
          </div>

          {/* quick actions */}
          <div className="flex flex-wrap gap-2 sm:flex-col">
            {revoked ? (
              <button disabled={busy} onClick={() => act({ action: "restore" }, "Access restored")} className="btn btn-primary text-sm">
                <ShieldCheck size={15} /> Restore
              </button>
            ) : (
              <button disabled={busy} onClick={() => act({ action: "revoke" }, "Access revoked")} className="btn btn-secondary text-sm text-danger">
                <ShieldOff size={15} /> Revoke
              </button>
            )}
            <button disabled={busy} onClick={() => act({ action: "extend", days: 30 }, "Extended by 30 days")} className="btn btn-secondary text-sm">
              <CalendarPlus size={15} /> +30 days
            </button>
            <button disabled={busy} onClick={() => setModal("edit")} className="btn btn-secondary text-sm">
              <Pencil size={15} /> Edit
            </button>
          </div>
        </div>
      </div>

      {/* ---------------- KPIs ---------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Total paid" value={formatINR(profile.totals.totalPaid)} tone="green" />
        <KpiTile label="Outstanding" value={formatINR(profile.totals.outstanding)} tone={profile.totals.outstanding > 0 ? "amber" : "blue"} />
        <KpiTile
          label="Next due"
          value={profile.totals.nextDue ? formatINR(profile.totals.nextDue.amount) : "—"}
          hint={profile.totals.nextDue?.due ? formatISTDate(profile.totals.nextDue.due) : "All clear"}
        />
        <KpiTile label="Tests attempted" value={profile.performance.totalAttempts} hint={`Avg ${profile.performance.avgAccuracy}% accuracy`} />
      </div>

      {/* ---------------- ACCESS CONTROL ---------------- */}
      <Card title="Access control" icon={<ShieldCheck size={17} />}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Set validity:</span>
            {(["1m", "3m", "6m", "12m"] as const).map((p) => (
              <button key={p} disabled={busy} onClick={() => act({ action: "set_validity", preset: p }, `Validity set to ${p.toUpperCase()}`)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold transition hover:border-primary hover:text-primary">
                {p.toUpperCase()}
              </button>
            ))}
            <button disabled={busy} onClick={() => act({ action: "set_validity", preset: "lifetime" }, "Set to Lifetime")} className="rounded-lg border border-saffron/40 bg-saffron/10 px-3 py-1.5 text-xs font-semibold text-saffron transition hover:bg-saffron/20">
              Lifetime ∞
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Custom valid-till date (IST)</label>
              <input
                type="date"
                value={customDate || (s.expiry_date ? isoToISTInput(s.expiry_date).slice(0, 10) : "")}
                onChange={(e) => setCustomDate(e.target.value)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              />
            </div>
            <button
              disabled={busy || !customDate}
              onClick={() => act({ action: "set_validity", preset: "custom", valid_till: customDate }, "Custom validity set")}
              className="btn btn-primary text-sm"
            >
              Set date
            </button>
          </div>

          <div className="rounded-xl bg-surface2 p-3 text-xs text-ink2">
            {revoked
              ? "Access is currently revoked — this student cannot log in or open gated content (their data is retained)."
              : s.expiry_date
                ? "Auto-expiry is active. When the valid-till date passes, login and gated content are blocked automatically; data is kept."
                : "Lifetime access — never expires unless revoked."}
          </div>

          {profile.accessLogs.length > 0 && (
            <details className="text-sm">
              <summary className="flex cursor-pointer items-center gap-1.5 text-muted"><History size={14} /> Access history ({profile.accessLogs.length})</summary>
              <ul className="mt-2 space-y-1.5">
                {profile.accessLogs.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 border-b border-line py-1.5 last:border-0">
                    <span className="text-ink2">{l.action}</span>
                    <span className="shrink-0 text-xs text-muted">{formatISTDateTime(l.timestamp)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Card>

      {/* ---------------- CUSTOMER JOURNEY (analytics) ---------------- */}
      <Card
        title="Customer journey"
        icon={<Activity size={17} />}
        action={
          <button onClick={() => setShowJourney((v) => !v)} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            {showJourney ? "Hide" : "View journey"}
          </button>
        }
      >
        {showJourney ? (
          <JourneyTimeline phone={s.phone} />
        ) : (
          <p className="text-sm text-muted">Source, campaign, first page and the full chronological activity timeline for this person.</p>
        )}
      </Card>

      {/* ---------------- ENROLLED COURSES ---------------- */}
      <Card
        title={`Enrolled courses (${profile.courses.length})`}
        icon={<GraduationCap size={17} />}
        action={<button onClick={() => { ensureCatalog(); setModal("enroll"); }} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"><Plus size={15} /> Enroll</button>}
      >
        {profile.courses.length === 0 ? (
          <Empty>No course enrollments yet.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {profile.courses.map((c) => (
              <div key={`${c.source}-${c.id}`} className="rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-snug">{c.title}</h3>
                  <span className={`pill ${c.remaining <= 0 ? "pill-green" : c.hasOverdue ? "pill-red" : "pill-amber"}`}>{c.status}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {c.source === "course" && c.paymentPlan && (
                    <span className="pill pill-blue">{PLAN_LABEL[c.paymentPlan]}</span>
                  )}
                  {c.previousPlan && c.previousPlan !== c.paymentPlan && (
                    <span className="text-[10px] text-muted">was {PLAN_LABEL[c.previousPlan]}</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>{c.plan}</span>
                  {c.batch && <span>· {c.batch}</span>}
                  <span>· Enrolled {formatISTDate(c.createdAt)}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface2">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${c.progressPct}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-ink2">{formatINR(c.paid)} <span className="text-muted">of {formatINR(c.total)}</span></span>
                  {c.remaining > 0 ? <span className="font-semibold text-warning">{formatINR(c.remaining)} due</span> : <span className="font-semibold text-success">Paid in full</span>}
                </div>
                {c.nextDue && c.remaining > 0 && (
                  <p className="mt-2 text-xs text-muted">Next: {c.nextDue.label} · {formatINR(c.nextDue.amount)}{c.nextDue.due ? ` · ${formatISTDate(c.nextDue.due)}` : ""}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {c.source === "course" && c.remaining > 0 && (
                    <button onClick={() => { setPayCourse(c); setModal("pay"); }} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><Wallet size={13} /> Record payment</button>
                  )}
                  {c.source === "course" && (
                    <button onClick={() => { setPlanCourse(c); setModal("changePlan"); }} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><Repeat size={13} /> Change plan</button>
                  )}
                  {c.source === "course" && (c.schedule?.length ?? 0) > 0 && (
                    <button onClick={() => { setPlanCourse(c); setModal("managePlan"); }} className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-primary"><SlidersHorizontal size={13} /> Manage installments</button>
                  )}
                  {c.slug && (
                    <Link href={`/courses/${c.slug}`} className="text-xs font-semibold text-muted hover:text-primary">View course →</Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---------------- WEBINARS ---------------- */}
      <Card
        title={`Webinars registered (${profile.webinars.length})`}
        icon={<Video size={17} />}
        action={<button onClick={() => { ensureCatalog(); setModal("webinar"); }} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"><Plus size={15} /> Register</button>}
      >
        {profile.webinars.length === 0 ? (
          <Empty>No webinars yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {profile.webinars.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{w.title}</p>
                  <p className="text-xs text-muted">{w.datetime ? formatISTDateTime(w.datetime) : "Date TBA"}</p>
                </div>
                <span className={`pill shrink-0 ${w.paid ? "pill-gold" : "pill-blue"}`}>{w.paid ? `Paid · ${formatINR(w.amount || 0)}` : "Free"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------- PAYMENTS LEDGER ---------------- */}
      <Card title="Payments ledger" icon={<Receipt size={17} />}>
        {profile.ledger.length === 0 ? (
          <Empty>No payments recorded yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="py-2 pr-3 font-semibold">Item</th>
                  <th className="py-2 pr-3 font-semibold">Type</th>
                  <th className="py-2 pr-3 font-semibold">Method</th>
                  <th className="py-2 pr-3 text-right font-semibold">Amount</th>
                  <th className="py-2 font-semibold">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {profile.ledger.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap py-2.5 pr-3 text-ink2">{formatISTDate(p.date)}</td>
                    <td className="py-2.5 pr-3">{p.label}</td>
                    <td className="py-2.5 pr-3"><span className="pill pill-gray capitalize">{p.type}</span></td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-ink2">{p.method}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right font-semibold tabular-nums">{formatINR(p.amount)}</td>
                    <td className="py-2.5">
                      {p.receiptNo ? (
                        <button onClick={() => downloadReceipt(p.receiptNo!)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                          <Download size={13} /> PDF
                        </button>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------- PERFORMANCE ---------------- */}
      <Card
        title="Activity & performance"
        icon={<Activity size={17} />}
        action={profile.performance.trend.length > 1 ? <Sparkline data={profile.performance.trend} /> : undefined}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="Attempts" value={profile.performance.totalAttempts} />
          <Mini label="Avg accuracy" value={`${profile.performance.avgAccuracy}%`} />
          <Mini label="Best score" value={`${profile.performance.bestPct}%`} />
          <Mini label="Day streak" value={profile.performance.streak} hint={profile.performance.lastActive ? `Last active ${formatISTDate(profile.performance.lastActive)}` : "—"} />
        </div>
        {profile.performance.recent.length === 0 ? (
          <Empty>No test attempts yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {profile.performance.recent.map((r) => (
              <li key={r.attemptId} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="text-xs text-muted">{r.submitted_at ? formatISTDate(r.submitted_at) : "—"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums">{r.score}/{r.max_score}</p>
                  <p className="text-xs text-muted">{r.accuracy}% accuracy</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {modal === "edit" && <EditModal student={s} busy={busy} onClose={() => setModal(null)} onSave={(body) => { act(body, "Profile updated"); setModal(null); }} />}
      {modal === "enroll" && <EnrollModal catalog={catalog} enrolledCourseTitles={profile.courses.map((c) => c.title)} busy={busy} onClose={() => setModal(null)} onSave={(body) => postAction("/enroll", body, "Enrolled")} />}
      {modal === "webinar" && <WebinarModal catalog={catalog} busy={busy} onClose={() => setModal(null)} onSave={(body) => postAction("/webinar", body, "Webinar registered")} />}
      {modal === "pay" && payCourse && <PayModal course={payCourse} busy={busy} onClose={() => setModal(null)} onSave={(body) => postAction("/payment", body, "Payment recorded")} />}
      {modal === "changePlan" && planCourse && (
        <ChangePlanModal
          course={planCourse}
          onClose={() => setModal(null)}
          request={(body) => rawPost("/change-plan", body)}
          onDone={(warnings) => { toast(warnings.length ? `Plan updated · ${warnings.join("; ")}` : "Payment plan updated", warnings.length ? "error" : "success"); setModal(null); load(); }}
        />
      )}
      {modal === "managePlan" && planCourse && (
        <ManagePlanModal
          course={planCourse}
          onClose={() => setModal(null)}
          request={(body) => rawPost("/installment", body)}
          onPay={() => { setPayCourse(planCourse); setModal("pay"); }}
          onDone={(msg) => { toast(msg, "success"); load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- modals
function EditModal({ student, busy, onClose, onSave }: { student: Student; busy: boolean; onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [name, setName] = useState(student.name);
  const [email, setEmail] = useState(student.email || "");
  const [targetYear, setTargetYear] = useState(student.target_year ? String(student.target_year) : "");
  const [notes, setNotes] = useState(student.notes || "");
  return (
    <Modal open onClose={onClose} title="Edit profile">
      <div className="space-y-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Name</span><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Target year</span><input value={targetYear} onChange={(e) => setTargetYear(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" className={inputCls} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Internal notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} /></label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button disabled={busy} onClick={() => onSave({ name, email: email || null, target_year: targetYear || null, notes: notes || null })} className="btn btn-primary text-sm">Save</button>
        </div>
      </div>
    </Modal>
  );
}

function EnrollModal({ catalog, enrolledCourseTitles, busy, onClose, onSave }: { catalog: { courses: Course[]; webinars: Webinar[] } | null; enrolledCourseTitles: string[]; busy: boolean; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [slug, setSlug] = useState("");
  const [plan, setPlan] = useState<"full" | "emi" | "complimentary">("full");
  const [bookSeat, setBookSeat] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const course = (catalog?.courses || []).find((c) => c.slug === slug);
  const cfg = course ? resolveEmiConfig(course) : null;
  const seatConfigured = !!cfg && cfg.enabled && (cfg.seatAmount != null || cfg.allowCustomSeat);
  const planned = course && plan !== "complimentary"
    ? planCourseEnrollment({ course, plan, bookSeat, installmentCount: plan === "emi" ? (count ?? cfg?.installmentCounts[0] ?? null) : null })
    : null;
  return (
    <Modal open onClose={onClose} title="Enroll into a course">
      {!catalog ? <LoadingBlock /> : (
        <div className="space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Course</span>
            <select value={slug} onChange={(e) => { setSlug(e.target.value); setPlan("full"); setBookSeat(false); setCount(null); }} className={inputCls}>
              <option value="">Select a course…</option>
              {catalog.courses.map((c) => <option key={c.id} value={c.slug} disabled={enrolledCourseTitles.includes(c.title)}>{c.title}{enrolledCourseTitles.includes(c.title) ? " (enrolled)" : ""}</option>)}
            </select>
          </label>
          {course && (
            <>
              <div className="flex flex-wrap gap-2">
                {(["full", "emi", "complimentary"] as const).map((p) => (
                  <button key={p} type="button" disabled={p === "emi" && !cfg?.enabled} onClick={() => { setPlan(p); setCount(p === "emi" ? cfg?.installmentCounts[0] ?? null : null); }} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${plan === p ? "border-primary bg-primary/10 text-primary" : "border-line"}`}>
                    {p === "full" ? "Pay in full" : p === "emi" ? "EMI" : "Complimentary"}
                  </button>
                ))}
              </div>
              {plan === "emi" && cfg && (
                <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted">Installments:</span>{cfg.installmentCounts.map((n) => <button key={n} onClick={() => setCount(n)} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${count === n ? "border-primary bg-primary/10 text-primary" : "border-line"}`}>{n}×</button>)}</div>
              )}
              {plan !== "complimentary" && seatConfigured && (
                <label className="flex items-center gap-2 text-xs text-ink2"><input type="checkbox" checked={bookSeat} onChange={(e) => setBookSeat(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" /> Book seat first {cfg?.seatAmount != null && !cfg?.allowCustomSeat ? `(${formatINR(cfg.seatAmount)})` : ""}</label>
              )}
              <p className="text-xs text-muted">{plan === "complimentary" ? "Free access at ₹0 — unlocks Class Hub, no payment." : planned?.ok ? `Total ${formatINR(planned.plan.totalFee)} · first payable ${formatINR(planned.plan.firstAmount)}. Record the payment afterwards from the course card.` : "Select a valid plan."}</p>
            </>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
            <button disabled={busy || !course} onClick={() => onSave({ courseSlug: slug, plan, bookSeat, installmentCount: count })} className="btn btn-primary text-sm">Enroll</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function WebinarModal({ catalog, busy, onClose, onSave }: { catalog: { courses: Course[]; webinars: Webinar[] } | null; busy: boolean; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [webinarId, setWebinarId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [date, setDate] = useState("");
  return (
    <Modal open onClose={onClose} title="Register for a webinar">
      {!catalog ? <LoadingBlock /> : (
        <div className="space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Webinar</span>
            <select value={webinarId} onChange={(e) => setWebinarId(e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {catalog.webinars.map((w) => <option key={w.id} value={w.id}>{w.title}{w.price > 0 ? ` · ${formatINR(w.price)}` : " · Free"}</option>)}
            </select>
          </label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Amount paid (₹, leave 0 for free)</span><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="0" /></label>
          {Number(amount) > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Method</span><select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Date (IST)</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></label>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
            <button disabled={busy || !webinarId} onClick={() => onSave({ webinarId, amount: amount ? Number(amount) : 0, method, dateISO: date || undefined })} className="btn btn-primary text-sm">Register</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PayModal({ course, busy, onClose, onSave }: { course: CourseCard; busy: boolean; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<boolean> }) {
  const options = course.unpaid;
  const [idx, setIdx] = useState(0);
  const [method, setMethod] = useState("Cash");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const sel = options[idx];
  const payFull = course.remaining;
  const [mode, setMode] = useState<"line" | "full">("line");
  const amount = mode === "full" ? payFull : sel?.amount ?? 0;
  return (
    <Modal open onClose={onClose} title={`Record payment · ${course.title}`}>
      <div className="space-y-3">
        <div className="rounded-xl bg-surface2 p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">Paid so far</span><span className="font-semibold">{formatINR(course.paid)} / {formatINR(course.total)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Outstanding</span><span className="font-semibold text-warning">{formatINR(course.remaining)}</span></div>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Settle</span>
          <div className="space-y-1.5">
            {options.map((o, i) => (
              <label key={`${o.kind}-${o.no}`} className="flex items-center gap-2 text-sm">
                <input type="radio" name="payline" checked={mode === "line" && idx === i} onChange={() => { setMode("line"); setIdx(i); }} className="accent-[var(--primary)]" />
                <span className="flex-1">{o.label}</span><span className="font-semibold">{formatINR(o.amount)}</span>
              </label>
            ))}
            {options.length > 1 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="payline" checked={mode === "full"} onChange={() => setMode("full")} className="accent-[var(--primary)]" />
                <span className="flex-1">Pay full remaining balance</span><span className="font-semibold">{formatINR(payFull)}</span>
              </label>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Method</span><select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Date (IST)</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></label>
        </div>
        <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Reference / note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="e.g. Receipt book #42" /></label>
        <p className="text-sm text-ink2">Recording <strong>{formatINR(amount)}</strong> ({method}). A branded receipt will be generated.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button
            disabled={busy || (mode === "line" && !sel)}
            onClick={() => onSave(
              mode === "full"
                ? { kind: "full", method, dateISO: date || undefined, note: note || undefined, enrollmentId: course.id }
                : { kind: sel.kind, installmentNo: sel.kind === "installment" ? sel.no : undefined, method, dateISO: date || undefined, note: note || undefined, enrollmentId: course.id }
            )}
            className="btn btn-primary text-sm"
          >Record {formatINR(amount)}</button>
        </div>
      </div>
    </Modal>
  );
}

type PlanReqResult = { ok: boolean; error?: string; warnings?: string[]; enrollment?: { schedule?: InstallmentItem[]; total_fee?: number } };

const EMI_COUNT_OPTIONS = [2, 3, 4, 6, 10, 12];

function ChangePlanModal({ course, onClose, request, onDone }: {
  course: CourseCard;
  onClose: () => void;
  request: (b: Record<string, unknown>) => Promise<PlanReqResult>;
  onDone: (warnings: string[]) => void;
}) {
  const current: PaymentPlan = course.paymentPlan || "FULL";
  const [plan, setPlan] = useState<PaymentPlan>(current === "FULL" ? "EMI" : "FULL");
  const [count, setCount] = useState(3);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<{ title: string; amount: string; due: string; grace: string; notes: string }[]>([
    { title: "Installment 1", amount: "", due: "", grace: "", notes: "" },
  ]);
  const [confirmBackdated, setConfirmBackdated] = useState(false);
  const [confirmDifference, setConfirmDifference] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outstanding = course.remaining;
  const customSum = lines.reduce((a, l) => a + (Math.round(Number(l.amount)) || 0), 0);
  const needsBackdated = !!error && /past/i.test(error);
  const needsDifference = !!error && /effective fee/i.test(error);
  const perEmi = count > 0 ? Math.floor(outstanding / count) : 0;

  async function submit() {
    setBusy(true); setError(null);
    const body: Record<string, unknown> = { enrollmentId: course.id, plan, reason: reason || null, confirmBackdated, confirmDifference };
    if (plan === "EMI") body.count = count;
    if (plan === "CUSTOM_INSTALLMENTS") {
      body.lines = lines.map((l) => ({ title: l.title, amount: Math.round(Number(l.amount)) || 0, due: l.due || null, grace: l.grace || null, notes: l.notes || null }));
    }
    const res = await request(body);
    setBusy(false);
    if (res.ok) { onDone(res.warnings || []); return; }
    setError(res.error || "Failed");
  }

  return (
    <Modal open onClose={onClose} title={`Change payment plan · ${course.title}`}>
      <div className="space-y-3">
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-ink2">
          Use this only when a student originally selected Full Payment but later requests EMI/custom installments. Existing paid amount will be preserved. The future outstanding amount will be converted into installments.
        </div>
        <div className="rounded-xl bg-surface2 p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">Current plan</span><span className="font-semibold">{PLAN_LABEL[current]}</span></div>
          <div className="flex justify-between"><span className="text-muted">Paid so far</span><span className="font-semibold">{formatINR(course.paid)} / {formatINR(course.total)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Outstanding</span><span className="font-semibold text-warning">{formatINR(outstanding)}</span></div>
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-muted">New plan</span>
          <div className="flex flex-wrap gap-2">
            {(["FULL", "EMI", "CUSTOM_INSTALLMENTS"] as PaymentPlan[]).map((p) => (
              <button key={p} type="button" onClick={() => { setPlan(p); setError(null); }} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${plan === p ? "border-primary bg-primary/10 text-primary" : "border-line"}`}>
                {p === "FULL" ? "Full payment" : p === "EMI" ? "EMI" : "Custom (staff)"}
              </button>
            ))}
          </div>
        </div>

        {plan === "EMI" && (
          <div>
            <span className="mb-1 block text-xs font-medium text-muted">Number of installments</span>
            <div className="flex flex-wrap items-center gap-2">
              {EMI_COUNT_OPTIONS.map((n) => (
                <button key={n} onClick={() => setCount(n)} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${count === n ? "border-primary bg-primary/10 text-primary" : "border-line"}`}>{n}×</button>
              ))}
              <input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Math.round(Number(e.target.value) || 1)))} className="w-16 rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
            </div>
            <p className="mt-2 text-xs text-muted">{formatINR(outstanding)} over {count} installments ≈ <strong>{formatINR(perEmi)}</strong> each (last absorbs the remainder). Due dates follow the course schedule.</p>
          </div>
        )}

        {plan === "FULL" && (
          <p className="text-xs text-muted">The remaining <strong>{formatINR(outstanding)}</strong> becomes a single outstanding balance. Unpaid installments are superseded; paid amounts are kept.</p>
        )}

        {plan === "CUSTOM_INSTALLMENTS" && (
          <div className="space-y-2">
            <span className="block text-xs font-medium text-muted">Custom installments (staff-only)</span>
            {lines.map((l, i) => (
              <div key={i} className="rounded-lg border border-line p-2.5">
                <div className="flex items-center gap-2">
                  <input value={l.title} onChange={(e) => setLines((xs) => xs.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder={`Installment ${i + 1}`} className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
                  <input type="number" value={l.amount} onChange={(e) => setLines((xs) => xs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} placeholder="Amount" className="w-28 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
                  {lines.length > 1 && <button onClick={() => setLines((xs) => xs.filter((_, j) => j !== i))} className="text-muted hover:text-danger"><XCircle size={16} /></button>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block"><span className="mb-0.5 block text-[10px] text-muted">Due date (IST)</span><input type="date" value={l.due} onChange={(e) => setLines((xs) => xs.map((x, j) => j === i ? { ...x, due: e.target.value } : x))} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" /></label>
                  <label className="block"><span className="mb-0.5 block text-[10px] text-muted">Grace date (optional)</span><input type="date" value={l.grace} onChange={(e) => setLines((xs) => xs.map((x, j) => j === i ? { ...x, grace: e.target.value } : x))} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" /></label>
                </div>
              </div>
            ))}
            <button onClick={() => setLines((xs) => [...xs, { title: `Installment ${xs.length + 1}`, amount: "", due: "", grace: "", notes: "" }])} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><Plus size={13} /> Add installment</button>
            <p className={`text-xs ${customSum === outstanding ? "text-muted" : "text-warning"}`}>Total {formatINR(customSum)} {customSum === outstanding ? "= outstanding" : `vs outstanding ${formatINR(outstanding)} — re-confirm to change the effective fee`}</p>
          </div>
        )}

        <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Reason / note (recommended)</span><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. Student requested EMI after booking seat" /></label>

        {needsBackdated && (
          <label className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-xs text-danger"><input type="checkbox" checked={confirmBackdated} onChange={(e) => setConfirmBackdated(e.target.checked)} className="accent-[var(--danger)]" /> I understand a backdated due date (&gt;15 days past) will immediately revoke access.</label>
        )}
        {needsDifference && (
          <label className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-xs text-ink2"><input type="checkbox" checked={confirmDifference} onChange={(e) => setConfirmDifference(e.target.checked)} className="accent-[var(--warning)]" /> I confirm changing the effective course fee (installments total differs from outstanding).</label>
        )}
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button disabled={busy} onClick={submit} className="btn btn-primary text-sm">{busy ? "Applying…" : "Apply plan change"}</button>
        </div>
      </div>
    </Modal>
  );
}

function ManagePlanModal({ course, onClose, request, onPay, onDone }: {
  course: CourseCard;
  onClose: () => void;
  request: (b: Record<string, unknown>) => Promise<PlanReqResult>;
  onPay: () => void;
  onDone: (msg: string) => void;
}) {
  const [sched, setSched] = useState<InstallmentItem[]>(course.schedule || []);
  const [totalFee, setTotalFee] = useState<number>(course.total);
  const [editNo, setEditNo] = useState<number | null>(null);
  const [editDue, setEditDue] = useState("");
  const [confirmBackdated, setConfirmBackdated] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const d = deriveEnrollment({ total_fee: totalFee, schedule: sched });

  async function run(body: Record<string, unknown>, key: string, okMsg: string) {
    setBusy(key); setError(null);
    const res = await request(body);
    setBusy(null);
    if (!res.ok) { setError(res.error || "Failed"); return; }
    if (res.enrollment?.schedule) setSched(res.enrollment.schedule);
    if (typeof res.enrollment?.total_fee === "number") setTotalFee(res.enrollment.total_fee);
    setEditNo(null); setConfirmBackdated(false);
    onDone(okMsg);
  }

  return (
    <Modal open onClose={onClose} title={`Manage installments · ${course.title}`}>
      <div className="space-y-3">
        <div className="rounded-xl bg-surface2 p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">Paid so far</span><span className="font-semibold">{formatINR(d.paid)} / {formatINR(totalFee)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Outstanding</span><span className="font-semibold text-warning">{formatINR(d.remaining)}</span></div>
        </div>

        <div className="divide-y divide-line rounded-xl border border-line">
          {sched.map((item) => {
            const st = installmentStatus(item);
            const editable = !item.paid && st !== "cancelled" && st !== "waived";
            return (
              <div key={item.no} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{item.label}</p>
                    <p className="text-xs text-muted">
                      {item.paid ? `Paid${item.paid_at ? ` · ${formatISTDate(item.paid_at)}` : ""}` : item.due ? `Due ${formatISTDate(item.due)}` : "Due now"}
                      <span className={`ml-1.5 pill ${st === "paid" ? "pill-green" : st === "overdue" ? "pill-red" : st === "waived" || st === "cancelled" ? "pill-gray" : "pill-amber"}`}>{st}</span>
                    </p>
                  </div>
                  <span className={`shrink-0 font-semibold ${item.paid ? "text-muted line-through" : st === "cancelled" || st === "waived" ? "text-muted line-through" : ""}`}>{formatINR(item.amount)}</span>
                </div>
                {editable && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {editNo === item.no ? (
                      <>
                        <input type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs" />
                        <button disabled={!!busy || !editDue} onClick={() => run({ enrollmentId: course.id, no: item.no, action: "edit_due", due: editDue, confirmBackdated }, `due${item.no}`, "Due date updated")} className="rounded-lg border border-primary px-2 py-1 text-xs font-semibold text-primary">Save</button>
                        <button onClick={() => { setEditNo(null); setConfirmBackdated(false); }} className="text-xs text-muted">Cancel</button>
                        <label className="flex items-center gap-1 text-[10px] text-muted"><input type="checkbox" checked={confirmBackdated} onChange={(e) => setConfirmBackdated(e.target.checked)} /> allow backdated</label>
                      </>
                    ) : (
                      <button onClick={() => { setEditNo(item.no); setEditDue(item.due ? isoToISTInput(item.due).slice(0, 10) : ""); }} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><CalendarClock size={12} /> Edit due</button>
                    )}
                    <button disabled={!!busy} onClick={() => run({ enrollmentId: course.id, no: item.no, action: "waive", reason: "Waived by admin" }, `w${item.no}`, "Installment waived")} className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-warning"><Ban size={12} /> Waive</button>
                    <button disabled={!!busy} onClick={() => run({ enrollmentId: course.id, no: item.no, action: "cancel", reason: "Cancelled by admin" }, `c${item.no}`, "Installment cancelled")} className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-danger"><XCircle size={12} /> Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

        {course.planHistory && course.planHistory.length > 0 && (
          <details className="text-sm">
            <summary className="flex cursor-pointer items-center gap-1.5 text-muted"><History size={14} /> Plan change history ({course.planHistory.length})</summary>
            <ul className="mt-2 space-y-1.5">
              {course.planHistory.map((h) => (
                <li key={h.id} className="border-b border-line py-1.5 text-xs last:border-0">
                  <span className="font-semibold">{h.oldPlan} → {h.newPlan}</span> · outstanding {formatINR(h.oldOutstanding)} → {formatINR(h.newOutstanding)}
                  {h.reason && <span className="text-muted"> · {h.reason}</span>}
                  <span className="block text-muted">{formatISTDateTime(h.createdAt)}{h.changedBy ? ` · by ${h.changedBy}` : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex justify-between gap-2 pt-1">
          {d.remaining > 0 ? <button onClick={onPay} className="btn btn-secondary text-sm"><Wallet size={14} /> Record payment</button> : <span />}
          <button onClick={onClose} className="btn btn-primary text-sm">Done</button>
        </div>
      </div>
    </Modal>
  );
}

function KpiTile({ label, value, hint, tone = "blue" }: { label: string; value: string | number; hint?: string; tone?: "blue" | "green" | "amber" | "red" }) {
  const dot: Record<string, string> = { blue: "var(--primary)", green: "var(--success)", amber: "var(--warning)", red: "var(--danger)" };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <span className="h-2 w-2 rounded-full" style={{ background: dot[tone] }} />
      </div>
      <p className="mt-2 font-heading text-xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Mini({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface2 p-3 text-center">
      <p className="font-heading text-lg font-extrabold text-primary">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted">{hint}</p>}
    </div>
  );
}
