import Link from "next/link";
import { redirect } from "next/navigation";
import { getBuyerSession } from "@/lib/session";
import { getBuyerByPhone, getBuyerPurchases, getCourseEnrollmentsByPhone, getActiveStaffGrantsByPhone, getAllCourses, getWebinars } from "@/lib/dataProvider";
import { resolveLearner } from "@/lib/entitlements";
import { getNewCountsForLearner } from "@/lib/classHubServer";
import { formatINR } from "@/lib/dates";
import { deriveEnrollment } from "@/lib/installments";
import type { Payment } from "@/lib/types";
import PortalLogoutButton from "@/components/portal/PortalLogoutButton";
import PaymentRecovery from "@/components/portal/PaymentRecovery";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "My Portal — Naman Sharma IAS Academy",
  robots: { index: false, follow: false },
};

const TYPE_META: Record<string, { label: string; icon: string }> = {
  course: { label: "Course", icon: "🎓" },
  webinar: { label: "Webinar", icon: "🎥" },
  plan: { label: "Subscription", icon: "💎" },
  item: { label: "Purchase", icon: "📦" },
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

interface Group {
  key: string;
  type: string;
  title: string;
  count: number;
  latest: Payment;
  items: Payment[];
}

/** Group purchases by unique item so a phone that bought the same webinar twice
 * shows ONE clean card with an enrollment count + expandable history. */
function groupPurchases(purchases: Payment[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of purchases) {
    const key = `${p.item_type}|${p.item_slug || p.item}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.items.push(p);
      if (new Date(p.created_at) > new Date(existing.latest.created_at)) existing.latest = p;
    } else {
      map.set(key, { key, type: p.item_type, title: p.item, count: 1, latest: p, items: [p] });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime()
  );
}

export default async function PortalDashboardPage() {
  const session = await getBuyerSession();
  if (!session) redirect("/portal/login");

  const [buyer, purchases, courseEnrollments, learner] = await Promise.all([
    getBuyerByPhone(session.phone),
    getBuyerPurchases(session.phone),
    getCourseEnrollmentsByPhone(session.phone),
    resolveLearner(),
  ]);
  const newCounts = await getNewCountsForLearner(learner);

  // Staff comp access (internal testing): if this phone is linked to a staff
  // account, surface the comped courses/webinars as a dedicated section so they
  // can open the real student view. No payments/enrolments exist for these.
  const staffGrants = await getActiveStaffGrantsByPhone(session.phone);
  const hasStaffAccess = staffGrants.courseIds.length > 0 || staffGrants.webinarIds.length > 0;
  const [staffCourses, staffWebinars] = hasStaffAccess
    ? await Promise.all([
        staffGrants.courseIds.length ? getAllCourses() : Promise.resolve([]),
        staffGrants.webinarIds.length ? getWebinars() : Promise.resolve([]),
      ])
    : [[], []];
  const compCourses = staffCourses.filter((c) => staffGrants.courseIds.includes(c.id));
  const compWebinars = staffWebinars.filter((w) => staffGrants.webinarIds.includes(w.id));

  // Confirmed course enrollments (seat or full paid) render as rich payment cards.
  const enrolledCourses = courseEnrollments.filter((e) => e.amount_paid > 0 && e.status !== "cancelled");
  const enrolledIds = new Set(enrolledCourses.map((e) => e.id));
  // Don't double-list payments that belong to a rich course enrollment.
  const otherPurchases = purchases.filter((p) => !(p.enrollment_id && enrolledIds.has(p.enrollment_id)));
  const groups = groupPurchases(otherPurchases);

  const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
    seat_booked: { label: "Seat Booked", cls: "pill-amber" },
    partially_paid: { label: "Installments in progress", cls: "pill-blue" },
    fully_paid: { label: "Fully Paid", cls: "pill-green" },
  };

  return (
    <div className="container-wide section">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="pill pill-blue mb-3">My Portal</p>
          <h1 className="text-3xl font-extrabold sm:text-4xl">
            {session.name ? `Welcome, ${session.name.split(" ")[0]}` : "Welcome"}
          </h1>
          <p className="mt-2 text-ink2">Everything you&apos;ve purchased, all in one place.</p>
        </div>
        <PortalLogoutButton />
      </div>

      {/* Self-service payment-proof recovery — only renders for items the buyer
          lacks access to with a PENDING/VERIFYING/FAILED payment. */}
      <PaymentRecovery />

      {buyer && (
        <div className="mt-6 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm">
          <span className="text-muted">Your login code:</span>
          <span className="font-mono font-bold tracking-[0.2em] text-primary">{buyer.login_code}</span>
        </div>
      )}

      {/* Staff comp access — internal test view (not a purchase) */}
      {hasStaffAccess && (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl font-bold">Staff test access</h2>
            <span className="pill pill-gold text-[11px]">Internal · not a purchase</span>
          </div>
          <p className="mt-1 text-sm text-ink2">Comped to you for QA/training. This is the real student view.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {compCourses.map((c) => (
              <div key={c.id} className="card flex h-full flex-col p-5">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🎓</span>
                  <span className="pill pill-gold text-xs">Course · comp</span>
                </div>
                <h3 className="mt-3 text-base font-semibold leading-snug">{c.title}</h3>
                <Link href={`/portal/class/${c.id}`} className="btn btn-primary mt-4 w-full text-sm">Go to Class Hub →</Link>
              </div>
            ))}
            {compWebinars.map((w) => (
              <div key={w.id} className="card flex h-full flex-col p-5">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🎥</span>
                  <span className="pill pill-gold text-xs">Webinar · comp</span>
                </div>
                <h3 className="mt-3 text-base font-semibold leading-snug">{w.title}</h3>
                <Link href={`/portal/item/${encodeURIComponent(w.slug)}`} className="btn btn-primary mt-4 w-full text-sm">Open webinar →</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My Courses & Payments (Book-Your-Seat + EMI) */}
      {enrolledCourses.length > 0 && (
        <section className="mt-8">
          <h2 className="font-heading text-xl font-bold">My Courses & Payments</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {enrolledCourses.map((e) => {
              const d = deriveEnrollment(e);
              const badge = STATUS_BADGE[e.status] || { label: e.status, cls: "pill-gray" };
              const nextDue = e.schedule.find((s) => !s.paid && s.due);
              return (
                <div key={e.id} className="card flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-2xl">🎓</span>
                    <div className="flex items-center gap-1.5">
                      {newCounts[e.course_id] > 0 && (
                        <span className="inline-flex items-center rounded-full bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)] px-2 py-0.5 text-[10px] font-extrabold text-[#1a1304]">
                          {newCounts[e.course_id]} new
                        </span>
                      )}
                      <span className={`pill text-xs ${badge.cls}`}>{badge.label}</span>
                    </div>
                  </div>
                  <h3 className="mt-3 text-base font-semibold leading-snug">{e.course_title}</h3>
                  {e.batch_label && <p className="mt-1 text-xs text-muted">{e.batch_label}</p>}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-ink">{formatINR(d.paid)} of {formatINR(e.total_fee)}</span>
                      <span className="text-muted">{d.progressPct}%</span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface2">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, d.progressPct)}%` }} />
                    </div>
                    {d.remaining > 0 ? (
                      <p className="mt-2 text-xs text-ink2">
                        Remaining {formatINR(d.remaining)}{nextDue ? ` · next ${formatINR(nextDue.amount)}` : ""}
                        {d.hasOverdue && <span className="ml-1 font-bold text-danger">· Overdue</span>}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs font-semibold text-success">Fully paid ✓</p>
                    )}
                  </div>
                  <Link href={`/portal/course/${e.id}`} className="btn btn-primary mt-4 w-full text-sm">
                    {d.remaining > 0 ? "View & pay →" : "View payments →"}
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {groups.length === 0 && enrolledCourses.length === 0 && !hasStaffAccess ? (
        <div className="mt-10 card p-8 text-center">
          <p className="text-lg font-semibold">No purchases found yet</p>
          <p className="mt-1 text-sm text-ink2">If you&apos;ve just paid, it can take a moment to appear. Refresh shortly.</p>
          <Link href="/courses" className="btn btn-primary mt-5">Browse courses →</Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => {
            const meta = TYPE_META[g.type] || TYPE_META.item;
            return (
              <div key={g.key} className="card flex h-full flex-col p-5">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{meta.icon}</span>
                  <div className="flex items-center gap-1.5">
                    {g.count > 1 && (
                      <span className="pill pill-blue text-xs">Registered {g.count}×</span>
                    )}
                    <span className="pill pill-gray text-xs">{meta.label}</span>
                  </div>
                </div>
                <h3 className="mt-3 text-base font-semibold leading-snug">{g.title}</h3>
                <div className="mt-2 text-xs text-muted">Latest: {fmtDate(g.latest.created_at)}</div>

                <Link
                  href={`/portal/item/${encodeURIComponent(g.latest.reference_no || g.latest.id)}`}
                  className="btn btn-primary mt-4 w-full text-sm"
                >
                  Open content →
                </Link>

                {g.count > 1 && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-primary">View {g.count} enrollments</summary>
                    <ul className="mt-2 space-y-2">
                      {g.items.map((p) => (
                        <li key={p.id} className="rounded-lg border border-line p-2 text-xs">
                          <div className="font-medium">{p.student_name || "—"}</div>
                          <div className="text-muted">{fmtDate(p.created_at)} · {p.amount > 0 ? formatINR(p.amount) : "Free"}</div>
                          <div className="truncate font-mono text-[10px] text-muted">{p.reference_no}</div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
