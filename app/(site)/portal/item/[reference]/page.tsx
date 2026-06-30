import Link from "next/link";
import { redirect } from "next/navigation";
import { getBuyerSession } from "@/lib/session";
import {
  getBuyerPurchases,
  getCourseBySlug,
  getWebinarBySlug,
  getSiteSettings,
  getOrientationVideosForTarget,
} from "@/lib/dataProvider";
import { resolvePortalItemAccess } from "@/lib/portalItemAccess";
import { formatINR, formatISTDateTime } from "@/lib/dates";
import { parseRecording } from "@/lib/recordingEmbed";
import { whatsappLink } from "@/lib/phone";
import type { PdfResource, PageSection, Payment, Review } from "@/lib/types";
import WebinarAccess from "@/components/portal/WebinarAccess";
import WebinarJoinSteps from "@/components/portal/WebinarJoinSteps";
import OrientationVideoGrid from "@/components/public/OrientationVideoGrid";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Purchase — Naman Sharma IAS Academy",
  robots: { index: false, follow: false },
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return <span className="text-amber-500" aria-label={`${r} out of 5`}>{"★".repeat(r)}{"☆".repeat(5 - r)}</span>;
}

export default async function PortalItemPage({ params }: { params: { reference: string } }) {
  const session = await getBuyerSession();
  if (!session) redirect("/portal/login");

  const reference = decodeURIComponent(params.reference || "");
  // SINGLE source-of-truth access check: a PAID purchase for this phone (paying
  // students, unchanged) OR staff comp access for this item (no payment row).
  const access = await resolvePortalItemAccess(reference, session.phone);
  const purchase = access.purchase;

  if (!access.ok) {
    return (
      <div className="container-wide section">
        <div className="mx-auto max-w-lg card p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-2xl text-danger">🔒</div>
          <h1 className="text-2xl font-bold">No access to this item</h1>
          <p className="mt-2 text-sm text-ink2">
            This content isn&apos;t part of your purchases. If you believe this is a mistake, please contact support.
          </p>
          <Link href="/portal" className="btn btn-primary mt-5">← Back to my portal</Link>
        </div>
      </div>
    );
  }

  const slug = access.slug;
  const course = access.itemType === "course" && slug ? await getCourseBySlug(slug) : null;
  const webinar = access.itemType === "webinar" && slug ? await getWebinarBySlug(slug) : null;

  // Enrollment history: every paid purchase of this same item by this phone.
  // Staff comp access has no payment rows, so the history is simply empty.
  const allPurchases = await getBuyerPurchases(session.phone);
  const enrollments: Payment[] = purchase
    ? allPurchases.filter(
        (p) => p.item_type === purchase.item_type && (p.item_slug || p.item) === (purchase.item_slug || purchase.item)
      )
    : [];

  // ---- Webinar rich experience ----
  if (webinar) {
    const sessionType: "live" | "recorded" = webinar.session_type === "recorded" ? "recorded" : "live";
    const recording = parseRecording(webinar.recording_link);
    // Hosted (uploaded video file) recording — preferred over the embed link.
    const hostedRecordingId =
      webinar.recording_upload_status === "completed" && webinar.recording_key ? webinar.id : null;
    const orientationVideos = await getOrientationVideosForTarget("webinar", webinar.id, { publishedOnly: true });
    const materials: PdfResource[] = (webinar.materials || []).filter((m) => m.url?.trim());
    const reviews: Review[] = (webinar.reviews || []).filter((r) => r.visible !== false && r.name?.trim());
    const sections: PageSection[] = (webinar.sections || []).filter((s) => s.visible !== false);
    const aboutHtml = webinar.about_html || webinar.long_description || null;

    // Cross-sell timing.
    const cs = webinar.cross_sell;
    const startMs = webinar.datetime ? new Date(webinar.datetime).getTime() : 0;
    const showCrossSell =
      !!cs?.enabled &&
      !!cs.title?.trim() &&
      (cs.show_timing !== "after_webinar" || Date.now() >= startMs);

    // WhatsApp help fallback — same admin-editable source as the floating button.
    const settings = await getSiteSettings();
    const waLink = whatsappLink(
      settings.brand.whatsapp || settings.brand.support_phone,
      `Hi, I'm registered for ${webinar.title} but having trouble joining. Please help.`
    );

    return (
      <div className="container-wide section">
        <Link href="/portal" className="text-sm text-primary">← My portal</Link>

        <div className="mt-3 card overflow-hidden">
          {webinar.cover_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={webinar.cover_image_url} alt={webinar.title} className="h-44 w-full object-cover sm:h-60" />
          )}
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill pill-blue">Webinar</span>
              {enrollments.length > 1 && <span className="pill pill-gray text-xs">Registered {enrollments.length}×</span>}
              {webinar.datetime && (
                <span className="pill pill-gray text-xs">
                  {formatISTDateTime(webinar.datetime)}
                </span>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-extrabold sm:text-3xl">{webinar.title}</h1>
            {webinar.description && <p className="mt-2 text-ink2">{webinar.description}</p>}

            {/* Moved-registration notice (FEATURE 5) — shows the NEW schedule. */}
            {purchase?.is_moved_registration && (
              <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <p className="font-heading text-sm font-bold text-primary">Your registration has been moved to the next live session.</p>
                <p className="mt-1 text-sm text-ink2">
                  This session is now scheduled for <b>{formatISTDateTime(webinar.datetime)}</b>. Your payment / access remains valid.
                </p>
              </div>
            )}

            {/* Smart, state-aware access */}
            <div className="mt-6">
              <WebinarAccess
                startISO={webinar.datetime || null}
                endISO={webinar.end_datetime || null}
                sessionType={sessionType}
                zoomLink={webinar.link || null}
                recording={recording}
                hostedRecordingId={hostedRecordingId}
                adminCompleted={webinar.status === "completed"}
                webinarId={webinar.id}
                webinarSlug={webinar.slug}
                registrationId={purchase?.reference_no ?? null}
              />
            </div>

            {/* Calm, step-by-step join guide for first-time / non-technical users */}
            <WebinarJoinSteps
              sessionType={sessionType}
              startISO={webinar.datetime || null}
              endISO={webinar.end_datetime || null}
              hasZoomLink={!!webinar.link}
              joinNote={webinar.join_note}
              waLink={waLink}
            />

            {/* About */}
            {aboutHtml && (
              <section className="mt-8">
                <h2 className="text-lg font-bold">About this session</h2>
                <div className="quiz-rich prose-portal mt-3 max-w-none text-ink2" dangerouslySetInnerHTML={{ __html: aboutHtml }} />
              </section>
            )}

            {/* Orientation / starter videos (reusable library links) */}
            {orientationVideos.length > 0 && (
              <section className="mt-8">
                <OrientationVideoGrid assigned={orientationVideos} />
              </section>
            )}

            {/* Materials (entitlement-gated) */}
            {materials.length > 0 && (
              <section className="mt-8">
                <h2 className="text-lg font-bold">Your materials</h2>
                <p className="text-sm text-muted">Downloadable resources included with your registration.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {materials.map((r, i) => (
                    <a
                      key={i}
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm font-medium transition hover:border-primary"
                    >
                      <span className="text-lg">📄</span>
                      <span className="flex-1">{r.label || "Resource"}</span>
                      <span className="text-xs text-primary">Open →</span>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Cross-sell */}
            {showCrossSell && cs && (
              <section className="mt-8 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-blue-50 p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="max-w-xl">
                    <span className="pill pill-blue text-xs">Exclusive for you</span>
                    <h3 className="mt-2 text-xl font-extrabold">{cs.title}</h3>
                    {cs.description && <p className="mt-1 text-sm text-ink2">{cs.description}</p>}
                    {cs.promo_code && (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-dashed border-primary/50 bg-white px-3 py-1.5 text-sm">
                        <span className="text-muted">Promo code:</span>
                        <span className="font-mono font-bold tracking-widest text-primary">{cs.promo_code}</span>
                      </div>
                    )}
                  </div>
                  {cs.href && (
                    <a href={cs.href} className="btn btn-primary whitespace-nowrap">{cs.cta_label?.trim() || "Explore →"}</a>
                  )}
                </div>
              </section>
            )}

            {/* Reviews */}
            {reviews.length > 0 && (
              <section className="mt-8">
                <h2 className="text-lg font-bold">What attendees say</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {reviews.map((r, i) => (
                    <div key={r.id || i} className="rounded-xl border border-line p-4">
                      <Stars rating={r.rating} />
                      <p className="mt-2 text-sm text-ink2">{r.text}</p>
                      <div className="mt-2 text-xs font-semibold">
                        {r.name}
                        {r.result && <span className="font-normal text-muted"> · {r.result}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Flexible rich-content sections */}
            {sections.length > 0 && (
              <section className="mt-8 space-y-5">
                {sections.map((s, i) => (
                  <div key={s.id || i}>
                    <h2 className="text-lg font-bold">{s.title}</h2>
                    {s.subtitle && <p className="text-sm text-muted">{s.subtitle}</p>}
                    {s.content && (
                      <div className="quiz-rich mt-2 max-w-none text-ink2" dangerouslySetInnerHTML={{ __html: s.content }} />
                    )}
                  </div>
                ))}
              </section>
            )}

            {/* Enrollment history */}
            {enrollments.length > 1 && (
              <details className="mt-8 rounded-xl border border-line p-4">
                <summary className="cursor-pointer text-sm font-semibold text-primary">
                  Your {enrollments.length} enrollments for this webinar
                </summary>
                <ul className="mt-3 space-y-2">
                  {enrollments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-xs">
                      <span className="font-medium">{p.student_name || "—"}</span>
                      <span className="text-muted">{fmtDate(p.created_at)} · {p.amount > 0 ? formatINR(p.amount) : "Free"}</span>
                      <span className="font-mono text-[10px] text-muted">{p.reference_no}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- Course / other purchases (simpler view, unchanged behaviour) ----
  const aboutHtml = course?.long_description || null;
  const videoUrl = course?.demo_video || null;
  const pdfs: PdfResource[] = (course?.pdf_resources || []) as PdfResource[];

  return (
    <div className="container-wide section">
      <Link href="/portal" className="text-sm text-primary">← My portal</Link>

      <div className="mt-3 card p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill pill-blue">{purchase ? purchase.item_type : access.itemType}</span>
          {enrollments.length > 1 && <span className="pill pill-gray text-xs">Registered {enrollments.length}×</span>}
          {purchase ? (
            <span className="pill pill-gray text-xs">Reference: {purchase.reference_no}</span>
          ) : (
            <span className="pill pill-gold text-xs">Staff access</span>
          )}
        </div>
        <h1 className="mt-3 text-2xl font-extrabold sm:text-3xl">{purchase?.item || access.title || course?.title || "Your access"}</h1>
        {purchase ? (
          <p className="mt-2 text-sm text-muted">
            Paid {purchase.amount > 0 ? formatINR(purchase.amount) : "Free"} · Status: {purchase.status}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">Staff comp access — internal testing view.</p>
        )}

        {videoUrl && (
          <div className="mt-6">
            <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">▶ Watch video</a>
          </div>
        )}

        {aboutHtml && (
          <div className="quiz-rich prose-portal mt-6 max-w-none text-ink2" dangerouslySetInnerHTML={{ __html: aboutHtml }} />
        )}

        {pdfs.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold">Downloads & resources</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {pdfs.map((r, i) => (
                <a
                  key={i}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-line p-3 text-sm font-medium hover:border-primary"
                >
                  <span className="text-lg">📄</span>
                  {r.label || "Resource"}
                </a>
              ))}
            </div>
          </div>
        )}

        {!videoUrl && !aboutHtml && pdfs.length === 0 && (
          <div className="mt-6 rounded-xl bg-surface p-4 text-sm text-ink2">
            Your purchase is confirmed. Access details for this item will appear here. For immediate help, use the WhatsApp
            button or contact support.
          </div>
        )}
      </div>
    </div>
  );
}
