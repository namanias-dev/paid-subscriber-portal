import Link from "next/link";
import { redirect } from "next/navigation";
import { getBuyerSession } from "@/lib/session";
import { getPaidPurchaseForPhone, getCourseBySlug, getWebinarBySlug } from "@/lib/dataProvider";
import { formatINR } from "@/lib/dates";
import type { PdfResource, PageSection } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Purchase — Naman Sharma IAS Academy",
  robots: { index: false, follow: false },
};

export default async function PortalItemPage({ params }: { params: { reference: string } }) {
  const session = await getBuyerSession();
  if (!session) redirect("/portal/login");

  const reference = decodeURIComponent(params.reference || "");
  // Server-side entitlement check: the purchase must be PAID AND belong to this phone.
  const purchase = await getPaidPurchaseForPhone(reference, session.phone);

  if (!purchase) {
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

  // Load the purchased item's protected content (only after entitlement passes).
  const slug = purchase.item_slug || "";
  const course = purchase.item_type === "course" && slug ? await getCourseBySlug(slug) : null;
  const webinar = purchase.item_type === "webinar" && slug ? await getWebinarBySlug(slug) : null;

  const aboutHtml = webinar?.about_html || course?.long_description || null;
  const videoUrl = webinar?.recording_link || webinar?.link || webinar?.video_config?.url || course?.demo_video || null;
  const pdfs: PdfResource[] = (webinar?.pdf_resources || course?.pdf_resources || []) as PdfResource[];
  const sections: PageSection[] = (webinar?.sections || []).filter((s) => s.visible !== false);

  return (
    <div className="container-wide section">
      <Link href="/portal" className="text-sm text-primary">← My portal</Link>

      <div className="mt-3 card p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill pill-blue">{purchase.item_type}</span>
          <span className="pill pill-gray text-xs">Reference: {purchase.reference_no}</span>
        </div>
        <h1 className="mt-3 text-2xl font-extrabold sm:text-3xl">{purchase.item}</h1>
        <p className="mt-2 text-sm text-muted">
          Paid {purchase.amount > 0 ? formatINR(purchase.amount) : "Free"} · Status: {purchase.status}
        </p>

        {videoUrl && (
          <div className="mt-6">
            <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              ▶ Watch {webinar ? "recording / live class" : "video"}
            </a>
          </div>
        )}

        {aboutHtml && (
          <div
            className="quiz-rich prose-portal mt-6 max-w-none text-ink2"
            dangerouslySetInnerHTML={{ __html: aboutHtml }}
          />
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

        {sections.length > 0 && (
          <div className="mt-8 space-y-5">
            {sections.map((s, i) => (
              <div key={s.id || i}>
                <h2 className="text-lg font-bold">{s.title}</h2>
                {s.subtitle && <p className="text-sm text-muted">{s.subtitle}</p>}
                {s.content && (
                  <div className="quiz-rich mt-2 max-w-none text-ink2" dangerouslySetInnerHTML={{ __html: s.content }} />
                )}
              </div>
            ))}
          </div>
        )}

        {!videoUrl && !aboutHtml && pdfs.length === 0 && sections.length === 0 && (
          <div className="mt-6 rounded-xl bg-surface p-4 text-sm text-ink2">
            Your purchase is confirmed. Access details for this item will appear here. For immediate help, use the WhatsApp
            button or contact support.
          </div>
        )}
      </div>
    </div>
  );
}
