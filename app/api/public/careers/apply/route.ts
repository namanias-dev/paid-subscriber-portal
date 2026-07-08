import { NextResponse } from "next/server";
import { SITE_URL, SUPPORT } from "@/lib/config";
import { rateLimited } from "@/lib/dataProvider";
import {
  getPositionBySlug,
  getCareersSettings,
  resolveFormFields,
  createApplication,
} from "@/lib/careers/store";
import { validateApplication } from "@/lib/careers/validate";
import { sendApplicantConfirmation, sendAdminNewApplication } from "@/lib/careers/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public application submission. Fully server-validated against the position's
 * effective form fields. Respects both the site-wide and per-position "accepting
 * applications" switches, and the position must be OPEN. Never trusts client
 * field values; files are re-checked against the private-key allowlist.
 */
export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    if (await rateLimited(`careers-apply:${ip}`, 8, 3600)) {
      return NextResponse.json({ ok: false, error: "Too many submissions. Please try again later." }, { status: 429 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      slug?: string;
      answers?: Record<string, unknown>;
      files?: Array<Record<string, unknown>>;
      honeypot?: string;
    };
    const slug = String(body.slug || "").trim();
    if (!slug) return NextResponse.json({ ok: false, error: "Missing position." }, { status: 400 });

    const settings = await getCareersSettings();
    if (!settings.accepting_applications) {
      return NextResponse.json({ ok: false, error: "Applications are currently closed." }, { status: 403 });
    }

    const position = await getPositionBySlug(slug);
    if (!position || position.status !== "open") {
      return NextResponse.json({ ok: false, error: "This position is no longer open." }, { status: 404 });
    }
    if (!position.accepting_applications) {
      return NextResponse.json({ ok: false, error: "This position is not accepting applications right now." }, { status: 403 });
    }

    const fields = await resolveFormFields(position);
    const result = validateApplication(fields, settings.subjects, {
      answers: body.answers,
      files: (body.files || []) as never,
      honeypot: body.honeypot,
    });
    if (!result.ok || !result.record) {
      return NextResponse.json({ ok: false, error: result.error || "Please check your answers." }, { status: 400 });
    }

    const application = await createApplication({
      ...result.record,
      position_id: position.id,
      position_title: position.title,
      position_slug: position.slug,
      source: "careers_site",
      ip,
    });

    // Best-effort emails (no-op without RESEND_API_KEY). Never block the response.
    const notifyTo = settings.notify_email || process.env.CAREERS_NOTIFY_EMAIL || SUPPORT.email;
    void sendApplicantConfirmation({
      to: application.email,
      name: application.full_name,
      positionTitle: position.title,
    }).catch(() => {});
    void sendAdminNewApplication({
      to: notifyTo,
      positionTitle: position.title,
      applicantName: application.full_name,
      phone: application.phone,
      email: application.email,
      location: [application.city, application.state].filter(Boolean).join(", ") || "—",
      subjects: application.subjects,
      adminUrl: `${SITE_URL}/admin/careers`,
    }).catch(() => {});

    return NextResponse.json({ ok: true, id: application.id });
  } catch (e) {
    console.error("[careers/apply] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "Could not submit your application. Please try again." }, { status: 500 });
  }
}
