import Link from "next/link";
import { redirect } from "next/navigation";
import { getBuyerSession } from "@/lib/session";
import { getBuyerByPhone, getBuyerPurchases, getCourseEnrollmentsByPhone, getActiveStaffGrantsByPhone, getAllCourses, getWebinars, getWebinarRegistrationIdsByPhone } from "@/lib/dataProvider";
import { resolveLearner } from "@/lib/entitlements";
import { getNewCountsForLearner } from "@/lib/classHubServer";
import { formatINR } from "@/lib/dates";
import { deriveEnrollment } from "@/lib/installments";
import type { Payment } from "@/lib/types";
import PortalLogoutButton from "@/components/portal/PortalLogoutButton";
import PaymentRecovery from "@/components/portal/PaymentRecovery";
import LeadPromoBanner, { type PromoItem } from "@/components/portal/LeadPromoBanner";
import EnrolledCard from "@/components/portal/EnrolledCard";

const courseCover = (c: { cover_image_url?: string | null; image?: string | null; mobile_image_url?: string | null } | undefined) =>
  c?.cover_image_url || c?.image || c?.mobile_image_url || null;
const webinarCover = (w: { cover_image_url?: string | null; mobile_image_url?: string | null } | undefined) =>
  w?.cover_image_url || w?.mobile_image_url || null;

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

  const [buyer, purchases, courseEnrollments, learner, regIds, allWebinars, allCoursesList, staffGrants] = await Promise.all([
    getBuyerByPhone(session.phone),
    getBuyerPurchases(session.phone),
    getCourseEnrollmentsByPhone(session.phone),
    resolveLearner(),
    getWebinarRegistrationIdsByPhone(session.phone),
    getWebinars(),
    getAllCourses(),
    getActiveStaffGrantsByPhone(session.phone),
  ]);
  const newCounts = await getNewCountsForLearner(learner);

  // Staff comp access (internal testing): if this phone is linked to a staff
  // account, surface the comped courses/webinars as a dedicated section so they
  // can open the real student view. No payments/enrolments exist for these.
  const hasStaffAccess = staffGrants.courseIds.length > 0 || staffGrants.webinarIds.length > 0;
  const compCourses = allCoursesList.filter((c) => staffGrants.courseIds.includes(c.id));
  const compWebinars = allWebinars.filter((w) => staffGrants.webinarIds.includes(w.id));

  // FREE webinars the user registered for (genuinely-free content, no payment row).
  // Excludes staff-comped ones (shown above) to avoid duplicates.
  const freeWebinars = allWebinars.filter(
    (w) => (w.price ?? 0) <= 0 && regIds.has(w.id) && !staffGrants.webinarIds.includes(w.id),
  );

  // Confirmed course enrollments (seat or full paid) render as rich payment cards.
  const enrolledCourses = courseEnrollments.filter((e) => e.amount_paid > 0 && e.status !== "cancelled");
  const enrolledIds = new Set(enrolledCourses.map((e) => e.id));
  // Don't double-list payments that belong to a rich course enrollment.
  const otherPurchases = purchases.filter((p) => !(p.enrollment_id && enrolledIds.has(p.enrollment_id)));
  const groups = groupPurchases(otherPurchases);

  // Lookups to surface the existing cover image (and webinar timing) on the
  // enrolled cards — display-only join, no new queries.
  const serverNow = Date.now();
  const courseById = new Map(allCoursesList.map((c) => [c.id, c]));
  const courseBySlug = new Map(allCoursesList.map((c) => [c.slug, c]));
  const webinarBySlug = new Map(allWebinars.map((w) => [w.slug, w]));
  const webinarByTitle = new Map(allWebinars.map((w) => [w.title, w]));
  const courseByTitle = new Map(allCoursesList.map((c) => [c.title, c]));

  // A "free user" (lead / marketing audience) has no paid purchases, no paid
  // enrolments and no staff comp — show them rotating Enroll nudges for paid items.
  const isFreeUser = purchases.length === 0 && enrolledCourses.length === 0 && !hasStaffAccess;
  const nowMs = Date.now();
  const promoItems: PromoItem[] = isFreeUser
    ? [
        ...allWebinars
          .filter((w) => (w.price ?? 0) > 0 && w.status !== "completed" && (!w.datetime || new Date(w.datetime).getTime() > nowMs))
          .slice(0, 4)
          .map((w): PromoItem => ({ kind: "webinar", title: w.title, href: `/webinars/${w.slug}`, subtitle: w.price ? formatINR(w.price) : undefined })),
        ...allCoursesList
          .filter((c) => c.status === "published")
          .slice(0, 4)
          .map((c): PromoItem => ({ kind: "course", title: c.title, href: `/courses/${c.slug}`, subtitle: c.price ? formatINR(c.price) : undefined })),
      ]
    : [];

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

      {/* Marketing nudges for leads / free users (paid items, Enroll CTA only). */}
      {promoItems.length > 0 && <LeadPromoBanner items={promoItems} />}

      {buyer && (
        <div className="mt-6 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm">
          <span className="text-muted">Your login code:</span>
          <span className="font-mono font-bold tracking-[0.2em] text-primary">{buyer.login_code}</span>
        </div>
      )}

      {/* My Tests & Results — available to every logged-in user (leads + students). */}
      <section className="mt-8">
        <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-heading text-lg font-bold">My Tests &amp; Results</h2>
            <p className="mt-1 text-sm text-ink2">Track every quiz you&apos;ve taken, review your results, resume or retake anytime.</p>
          </div>
          <Link href="/portal/quizzes" className="btn btn-primary text-sm">Open my tests →</Link>
        </div>
      </section>

      {/* Staff comp access — internal test view (not a purchase) */}
      {hasStaffAccess && (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl font-bold">Staff test access</h2>
            <span className="pill pill-gold text-[11px]">Internal · not a purchase</span>
          </div>
          <p className="mt-1 text-sm text-ink2">Comped to you for QA/training. This is the real student view.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {compCourses.map((c, i) => (
              <EnrolledCard
                key={c.id}
                index={i}
                variant="course"
                title={c.title}
                description={c.description}
                image={courseCover(c)}
                metaLine={c.faculty || c.duration || null}
                href={`/portal/class/${c.id}`}
                cta="Go to Class Hub"
                cornerBadge={{ label: "Comp", tone: "gold" }}
              />
            ))}
            {compWebinars.map((w, i) => (
              <EnrolledCard
                key={w.id}
                index={compCourses.length + i}
                variant="webinar"
                title={w.title}
                description={w.description}
                image={webinarCover(w)}
                datetime={w.datetime}
                endDatetime={w.end_datetime}
                adminStatus={w.status}
                serverNow={serverNow}
                href={`/portal/item/${encodeURIComponent(w.slug)}`}
                cornerBadge={{ label: "Comp", tone: "gold" }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Free webinars the user registered for (no purchase — genuinely free). */}
      {freeWebinars.length > 0 && (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl font-bold">Free webinars</h2>
            <span className="pill pill-green text-[11px]">Free · registered</span>
          </div>
          <p className="mt-1 text-sm text-ink2">Sessions you registered for, free of charge.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {freeWebinars.map((w, i) => (
              <EnrolledCard
                key={w.id}
                index={i}
                variant="webinar"
                title={w.title}
                description={w.description}
                image={webinarCover(w)}
                datetime={w.datetime}
                endDatetime={w.end_datetime}
                adminStatus={w.status}
                serverNow={serverNow}
                href={`/portal/item/${encodeURIComponent(w.slug)}`}
                cornerBadge={{ label: "Free", tone: "green" }}
              />
            ))}
          </div>
        </section>
      )}

      {/* My Courses & Payments (Book-Your-Seat + EMI) */}
      {enrolledCourses.length > 0 && (
        <section className="mt-8">
          <h2 className="font-heading text-xl font-bold">My Courses & Payments</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {enrolledCourses.map((e, i) => {
              const d = deriveEnrollment(e);
              const badge = STATUS_BADGE[e.status] || { label: e.status, cls: "pill-gray" };
              const nextDue = d.nextPayable && d.nextPayable.due ? d.nextPayable : undefined;
              const tone = e.status === "fully_paid" ? "green" : e.status === "seat_booked" ? "amber" : "blue";
              const course = courseById.get(e.course_id) || courseBySlug.get(e.course_slug);
              return (
                <EnrolledCard
                  key={e.id}
                  index={i}
                  variant="course"
                  title={e.course_title}
                  image={courseCover(course)}
                  metaLine={e.batch_label}
                  href={`/portal/course/${e.id}`}
                  cta={d.remaining > 0 ? "View & pay" : "View payments"}
                  cornerBadge={{ label: badge.label, tone }}
                  newCount={newCounts[e.course_id] || 0}
                  progressPct={d.progressPct}
                  progressNote={`${formatINR(d.paid)} of ${formatINR(e.total_fee)}`}
                  progressFootnote={
                    d.remaining > 0 ? (
                      <>
                        Remaining {formatINR(d.remaining)}{nextDue ? ` · next ${formatINR(nextDue.amount)}` : ""}
                        {d.hasOverdue && <span className="ml-1 font-bold text-danger">· Overdue</span>}
                      </>
                    ) : (
                      <span className="font-semibold text-success">Fully paid ✓</span>
                    )
                  }
                />
              );
            })}
          </div>
        </section>
      )}

      {groups.length === 0 && enrolledCourses.length === 0 && !hasStaffAccess && freeWebinars.length === 0 ? (
        <div className="mt-10 card p-8 text-center">
          <p className="text-lg font-semibold">No purchases found yet</p>
          <p className="mt-1 text-sm text-ink2">If you&apos;ve just paid, it can take a moment to appear. Refresh shortly.</p>
          <Link href="/courses" className="btn btn-primary mt-5">Browse courses →</Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g, i) => {
            const meta = TYPE_META[g.type] || TYPE_META.item;
            const slug = g.latest.item_slug || "";
            const web = g.type === "webinar" ? (webinarBySlug.get(slug) || webinarByTitle.get(g.title)) : undefined;
            const crs = g.type === "course" ? (courseBySlug.get(slug) || courseByTitle.get(g.title)) : undefined;
            const variant = g.type === "webinar" ? "webinar" : g.type === "course" ? "course" : "generic";
            return (
              <EnrolledCard
                key={g.key}
                index={i}
                variant={variant}
                title={g.title}
                description={web?.description || crs?.description || null}
                image={web ? webinarCover(web) : crs ? courseCover(crs) : null}
                datetime={web?.datetime}
                endDatetime={web?.end_datetime}
                adminStatus={web?.status}
                serverNow={serverNow}
                metaLine={variant === "course" ? (crs?.faculty || crs?.duration || `Latest: ${fmtDate(g.latest.created_at)}`) : variant === "generic" ? `Latest: ${fmtDate(g.latest.created_at)}` : null}
                href={`/portal/item/${encodeURIComponent(g.latest.reference_no || g.latest.id)}`}
                cta={variant === "generic" ? "Open content" : undefined}
                cornerBadge={g.count > 1 ? { label: `Registered ${g.count}×`, tone: "blue" } : { label: meta.label, tone: "gray" }}
                footerSlot={
                  g.count > 1 ? (
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
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
