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
} from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import StatusPill, { statusOf } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatISTDate, formatISTDateTime, isoToISTInput } from "@/lib/dates";
import { downloadReceiptPdf, type ReceiptContact } from "@/lib/receiptPdf";
import type { Student, PaymentReceipt } from "@/lib/types";

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

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/students/${params.id}`)
      .then((r) => r.json())
      .then((d) => setProfile(d.ok ? d.profile : null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

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
            <button disabled title="Coming in Part B" className="btn btn-secondary cursor-not-allowed text-sm opacity-50">
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

      {/* ---------------- ENROLLED COURSES ---------------- */}
      <Card title={`Enrolled courses (${profile.courses.length})`} icon={<GraduationCap size={17} />}>
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
                {c.slug && (
                  <Link href={`/courses/${c.slug}`} className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">View course →</Link>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---------------- WEBINARS ---------------- */}
      <Card title={`Webinars registered (${profile.webinars.length})`} icon={<Video size={17} />}>
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
    </div>
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
