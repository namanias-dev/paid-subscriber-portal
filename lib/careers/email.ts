import { EMAIL_ENABLED, SUPPORT } from "@/lib/config";

/**
 * Careers emails — optional & best-effort. Reuses the same Resend setup as the
 * rest of the app. Silently no-ops (returns {sent:false}) when RESEND_API_KEY is
 * absent. Never throws. No applicant PII is logged.
 *
 * TODO(owner): verify the "from" domain (namanias.com) is verified in Resend for
 * deliverability, and set CAREERS_NOTIFY_EMAIL (or careers_settings.notify_email)
 * to route admin notifications to the right inbox.
 */

const FROM = "Naman IAS Academy Careers <noreply@namanias.com>";

export async function sendApplicantConfirmation(params: {
  to: string;
  name: string;
  positionTitle: string;
}): Promise<{ sent: boolean }> {
  if (!EMAIL_ENABLED || !params.to) return { sent: false };
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY as string);
    await resend.emails.send({
      from: FROM,
      to: params.to,
      subject: `We received your application — ${params.positionTitle}`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;background:#0a1a3f;color:#e8e8f0;padding:24px;border-radius:12px">
          <h2 style="color:#d4af37">Thank you, ${escapeHtml(params.name)}! 🎯</h2>
          <p>We've received your application for <b>${escapeHtml(params.positionTitle)}</b> at Naman IAS Academy.</p>
          <p>Our team will review it and reach out if there's a match. No action is needed from you right now.</p>
          <p style="color:#8899bb;margin-top:16px">Questions? Contact us at ${escapeHtml(SUPPORT.email)} — Naman Sir's Team</p>
        </div>`,
    });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

export async function sendAdminNewApplication(params: {
  to: string;
  positionTitle: string;
  applicantName: string;
  phone: string;
  email: string;
  location: string;
  subjects: string[];
  adminUrl: string;
}): Promise<{ sent: boolean }> {
  if (!EMAIL_ENABLED || !params.to) return { sent: false };
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY as string);
    await resend.emails.send({
      from: FROM,
      to: params.to,
      subject: `New application: ${params.positionTitle} — ${params.applicantName}`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;padding:20px;color:#1a1a1a">
          <h2 style="color:#0057ff">New application received</h2>
          <p><b>Position:</b> ${escapeHtml(params.positionTitle)}</p>
          <p><b>Applicant:</b> ${escapeHtml(params.applicantName)}</p>
          <p><b>Phone:</b> ${escapeHtml(params.phone)}</p>
          <p><b>Email:</b> ${escapeHtml(params.email)}</p>
          <p><b>Location:</b> ${escapeHtml(params.location)}</p>
          <p><b>Subjects:</b> ${escapeHtml(params.subjects.join(", ") || "—")}</p>
          <p><a href="${params.adminUrl}" style="color:#0057ff">Open in admin →</a></p>
        </div>`,
    });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
