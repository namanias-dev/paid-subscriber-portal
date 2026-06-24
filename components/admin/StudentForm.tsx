"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, User, GraduationCap, Video, Wallet, Check, Copy, MessageCircle } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import { useToast } from "@/components/ui/Toast";
import { PLANS } from "@/lib/config";
import { formatINR } from "@/lib/dates";
import { resolveEmiConfig, payInFullTotal, planCourseEnrollment } from "@/lib/installments";
import type { Course, Webinar } from "@/lib/types";

type CtxPlan = "full" | "emi" | "complimentary";
interface CourseChoice {
  plan: CtxPlan;
  bookSeat: boolean;
  installmentCount: number | null;
  seatAmount: number | null;
}

const METHODS = ["Cash", "Bank Transfer", "Offline UPI"];

function Section({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 font-heading text-base font-bold"><span className="text-primary">{icon}</span>{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm focus:border-primary focus:outline-none";

export default function StudentForm() {
  const router = useRouter();
  const { toast } = useToast();

  const [courses, setCourses] = useState<Course[] | null>(null);
  const [webinars, setWebinars] = useState<Webinar[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ code: string; portalCode?: string | null; whatsappLink: string | null; id: string } | null>(null);

  // Profile
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [targetYear, setTargetYear] = useState("");
  const [plan, setPlan] = useState("3m");
  const [validityMode, setValidityMode] = useState<"plan" | "custom">("plan");
  const [validTill, setValidTill] = useState("");
  const [notes, setNotes] = useState("");

  // Enrollments
  const [picked, setPicked] = useState<Record<string, CourseChoice>>({});
  const [webPicked, setWebPicked] = useState<Record<string, boolean>>({});

  // Initial payment
  const [payCourse, setPayCourse] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payDate, setPayDate] = useState("");
  const [payNote, setPayNote] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/courses").then((r) => r.json()),
      fetch("/api/admin/webinars").then((r) => r.json()),
    ]).then(([c, w]) => {
      setCourses((c.courses || []).filter((x: Course) => x.status === "published" && x.active !== false));
      setWebinars((w.webinars || []).filter((x: Webinar) => x.active !== false));
    });
  }, []);

  const enrolledNonComp = useMemo(
    () => Object.entries(picked).filter(([, v]) => v.plan !== "complimentary"),
    [picked]
  );

  function toggleCourse(slug: string) {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[slug]) { delete next[slug]; if (payCourse === slug) setPayCourse(""); }
      else next[slug] = { plan: "full", bookSeat: false, installmentCount: null, seatAmount: null };
      return next;
    });
  }
  function setChoice(slug: string, patch: Partial<CourseChoice>) {
    setPicked((prev) => ({ ...prev, [slug]: { ...prev[slug], ...patch } }));
  }

  /** Compute the first payable line for a chosen course (mirrors online checkout). */
  function plannedFor(course: Course, choice: CourseChoice) {
    if (choice.plan === "complimentary") return null;
    const res = planCourseEnrollment({
      course,
      plan: choice.plan,
      bookSeat: choice.bookSeat,
      seatAmount: choice.seatAmount,
      installmentCount: choice.installmentCount,
    });
    return res.ok ? res.plan : null;
  }

  async function submit() {
    if (!name.trim()) return toast("Enter the student's name", "error");
    if (!/^\d{10}$/.test(phone)) return toast("Enter a valid 10-digit phone", "error");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("Enter a valid email or leave blank", "error");

    const courseList = Object.entries(picked).map(([courseSlug, c]) => ({
      courseSlug,
      plan: c.plan,
      bookSeat: c.bookSeat,
      seatAmount: c.seatAmount,
      installmentCount: c.installmentCount,
    }));
    const webinarList = Object.entries(webPicked).filter(([, v]) => v).map(([id]) => id);

    let initialPayment: Record<string, unknown> | undefined;
    if (payCourse) {
      const course = (courses || []).find((c) => c.slug === payCourse);
      const choice = picked[payCourse];
      const planned = course && choice ? plannedFor(course, choice) : null;
      if (planned) {
        initialPayment = { courseSlug: payCourse, kind: planned.firstKind, method: payMethod, dateISO: payDate || undefined, note: payNote || undefined };
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone,
          email: email.trim() || null,
          plan,
          valid_till: validityMode === "custom" && validTill ? validTill : undefined,
          target_year: targetYear || null,
          notes: notes.trim() || null,
          courses: courseList,
          webinars: webinarList,
          initialPayment,
        }),
      });
      const data = await res.json();
      if (!data.ok) { toast(data.error || "Failed to add student", "error"); setSaving(false); return; }
      if (data.warnings?.length) toast(`Saved with notes: ${data.warnings.join("; ")}`, "info");
      else toast("Student created", "success");
      setDone({ code: data.student.access_code, whatsappLink: data.whatsappLink, id: data.student.id });
    } catch {
      toast("Network error", "error");
      setSaving(false);
    }
  }

  if (!courses || !webinars) return <LoadingBlock />;

  if (done) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="card p-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-success/10 text-success"><Check size={28} /></div>
          <h1 className="font-heading text-xl font-bold">Student created</h1>
          <p className="mt-1 text-sm text-muted">Share the login code so they can sign in.</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="rounded-lg border border-line bg-surface2 px-4 py-2 font-mono text-lg font-bold text-primary">{done.code}</span>
            <button onClick={() => { navigator.clipboard.writeText(done.code); toast("Copied", "success"); }} className="btn btn-secondary text-sm"><Copy size={14} /> Copy</button>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {done.whatsappLink && <a href={done.whatsappLink} target="_blank" rel="noreferrer" className="btn btn-secondary text-sm"><MessageCircle size={15} /> Send on WhatsApp</a>}
            <Link href={`/admin/students/${done.id}`} className="btn btn-primary text-sm">Open profile →</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-28">
      <Link href="/admin/students" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Students &amp; Enrollments</Link>
      <div>
        <h1 className="font-heading text-2xl font-extrabold">Add student</h1>
        <p className="text-sm text-muted">Create a full profile, enroll in courses &amp; webinars, and optionally record a payment — all in one go.</p>
      </div>

      <Section icon={<User size={17} />} title="Profile">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name *"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Aarav Sharma" /></Field>
          <Field label="Phone (10-digit) *"><input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" className={inputCls} placeholder="9876543210" /></Field>
          <Field label="Email (optional)"><input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="name@email.com" /></Field>
          <Field label="Target year (optional)"><input value={targetYear} onChange={(e) => setTargetYear(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" className={inputCls} placeholder="2027" /></Field>
        </div>

        <div className="mt-4">
          <span className="mb-1 block text-xs font-medium text-muted">Access validity</span>
          <div className="flex flex-wrap gap-2">
            {PLANS.map((p) => (
              <button key={p.id} type="button" onClick={() => { setPlan(p.id); setValidityMode("plan"); }} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${plan === p.id && validityMode === "plan" ? "border-primary bg-primary/10 text-primary" : "border-line hover:border-primary"}`}>
                {p.id === "lifetime" ? "Lifetime ∞" : p.name}
              </button>
            ))}
            <button type="button" onClick={() => setValidityMode("custom")} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${validityMode === "custom" ? "border-primary bg-primary/10 text-primary" : "border-line hover:border-primary"}`}>Custom date</button>
          </div>
          {validityMode === "custom" && (
            <div className="mt-2"><Field label="Valid till (IST)"><input type="date" value={validTill} onChange={(e) => setValidTill(e.target.value)} className={inputCls} /></Field></div>
          )}
        </div>

        <div className="mt-4"><Field label="Internal notes (optional, never shown to student)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="e.g. Walk-in admission, paid seat in cash" /></Field></div>
      </Section>

      <Section icon={<GraduationCap size={17} />} title="Enroll into courses" subtitle="Select one or more. Each behaves exactly like an online enrollment.">
        {courses.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No published courses.</p>
        ) : (
          <div className="space-y-3">
            {courses.map((c) => {
              const choice = picked[c.slug];
              const cfg = resolveEmiConfig(c);
              const seatConfigured = cfg.enabled && (cfg.seatAmount != null || cfg.allowCustomSeat);
              const planned = choice ? plannedFor(c, choice) : null;
              return (
                <div key={c.id} className={`rounded-xl border p-4 transition ${choice ? "border-primary/40 bg-primary/[0.03]" : "border-line"}`}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={!!choice} onChange={() => toggleCourse(c.slug)} className="mt-1 h-4 w-4 accent-[var(--primary)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{c.title}</span>
                        <span className="text-sm text-muted">{formatINR(payInFullTotal(c))}{payInFullTotal(c) < c.price ? <span className="ml-1 text-xs line-through">{formatINR(c.price)}</span> : null}</span>
                      </div>
                      {choice && (
                        <div className="mt-3 space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {(["full", "emi", "complimentary"] as CtxPlan[]).map((p) => {
                              const disabled = p === "emi" && !cfg.enabled;
                              return (
                                <button key={p} type="button" disabled={disabled} onClick={() => setChoice(c.slug, { plan: p, bookSeat: false, installmentCount: p === "emi" ? cfg.installmentCounts[0] : null })} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition disabled:opacity-40 ${choice.plan === p ? "border-primary bg-primary/10 text-primary" : "border-line hover:border-primary"}`}>
                                  {p === "full" ? "Pay in full" : p === "emi" ? "EMI / Installments" : "Complimentary"}
                                </button>
                              );
                            })}
                          </div>

                          {choice.plan === "emi" && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-muted">Installments:</span>
                              {cfg.installmentCounts.map((n) => (
                                <button key={n} type="button" onClick={() => setChoice(c.slug, { installmentCount: n })} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${choice.installmentCount === n ? "border-primary bg-primary/10 text-primary" : "border-line hover:border-primary"}`}>{n}×</button>
                              ))}
                            </div>
                          )}

                          {choice.plan !== "complimentary" && seatConfigured && (
                            <label className="flex items-center gap-2 text-xs text-ink2">
                              <input type="checkbox" checked={choice.bookSeat} onChange={(e) => setChoice(c.slug, { bookSeat: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
                              Book seat first {cfg.seatAmount != null && !cfg.allowCustomSeat ? `(${formatINR(cfg.seatAmount)})` : ""}
                            </label>
                          )}
                          {choice.plan !== "complimentary" && choice.bookSeat && cfg.allowCustomSeat && (
                            <Field label="Seat amount (₹)"><input type="number" value={choice.seatAmount ?? ""} onChange={(e) => setChoice(c.slug, { seatAmount: e.target.value ? Number(e.target.value) : null })} className={inputCls} placeholder={`min ${cfg.minSeatAmount ?? 1}`} /></Field>
                          )}

                          <p className="text-xs text-muted">
                            {choice.plan === "complimentary"
                              ? "Free access — unlocks Class Hub at ₹0, no payment recorded."
                              : planned
                                ? `Total ${formatINR(planned.totalFee)} · First payable ${formatINR(planned.firstAmount)} (${planned.firstKind === "seat" ? "seat" : planned.firstKind === "installment" ? "installment 1" : "full"})`
                                : "Select a valid plan."}
                          </p>
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section icon={<Video size={17} />} title="Register for webinars" subtitle="Optional. Multiple allowed.">
        {webinars.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No webinars available.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {webinars.map((w) => (
              <label key={w.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${webPicked[w.id] ? "border-primary/40 bg-primary/[0.03]" : "border-line"}`}>
                <input type="checkbox" checked={!!webPicked[w.id]} onChange={(e) => setWebPicked((p) => ({ ...p, [w.id]: e.target.checked }))} className="h-4 w-4 accent-[var(--primary)]" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{w.title}</span>
                {w.price > 0 && <span className="pill pill-gold text-[11px]">{formatINR(w.price)}</span>}
              </label>
            ))}
          </div>
        )}
      </Section>

      {enrolledNonComp.length > 0 && (
        <Section icon={<Wallet size={17} />} title="Record initial payment" subtitle="Optional. Records the first payable line (seat / installment / full) as an offline payment + receipt.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="For course">
              <select value={payCourse} onChange={(e) => setPayCourse(e.target.value)} className={inputCls}>
                <option value="">No payment now</option>
                {enrolledNonComp.map(([slug]) => {
                  const c = courses.find((x) => x.slug === slug);
                  return <option key={slug} value={slug}>{c?.title}</option>;
                })}
              </select>
            </Field>
            {payCourse && (
              <>
                <Field label="Method">
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={inputCls}>
                    {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Date (IST, optional)"><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputCls} /></Field>
                <Field label="Reference / note (optional)"><input value={payNote} onChange={(e) => setPayNote(e.target.value)} className={inputCls} placeholder="e.g. Receipt book #42" /></Field>
              </>
            )}
          </div>
          {payCourse && (() => {
            const c = courses.find((x) => x.slug === payCourse);
            const choice = picked[payCourse];
            const planned = c && choice ? plannedFor(c, choice) : null;
            return planned ? <p className="mt-3 text-sm text-ink2">Will record <strong>{formatINR(planned.firstAmount)}</strong> ({payMethod}) and generate a receipt.</p> : null;
          })()}
        </Section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link href="/admin/students" className="btn btn-secondary text-sm">Cancel</Link>
          <button onClick={submit} disabled={saving} className="btn btn-primary text-sm disabled:opacity-60">{saving ? "Creating…" : "Create student"}</button>
        </div>
      </div>
    </div>
  );
}
