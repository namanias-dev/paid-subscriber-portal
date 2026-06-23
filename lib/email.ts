import { EMAIL_ENABLED } from "./config";

interface SendCodeEmailParams {
  to: string;
  name: string;
  code: string;
  planName: string;
  expiry: string;
}

/**
 * Sends the welcome/access-code email via Resend.
 * Silently skips (returns {sent:false}) when no RESEND_API_KEY is set.
 * Never throws.
 */
export async function sendAccessCodeEmail(
  params: SendCodeEmailParams
): Promise<{ sent: boolean }> {
  if (!EMAIL_ENABLED || !params.to) return { sent: false };
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY as string);
    await resend.emails.send({
      from: "Naman IAS Academy <noreply@namanias.com>",
      to: params.to,
      subject: "Your Naman IAS Academy access code",
      html: `
        <div style="font-family:Inter,Arial,sans-serif;background:#0a1628;color:#e8e8f0;padding:24px;border-radius:12px">
          <h2 style="color:#c9a84c">Welcome, ${params.name}! 🎯</h2>
          <p>Your access to <b>Naman Sharma IAS Academy</b> Premium Community is ready.</p>
          <p>Your access code:</p>
          <p style="font-size:20px;letter-spacing:3px;color:#c9a84c;font-family:monospace">${params.code}</p>
          <p>Plan: <b>${params.planName}</b> · Valid till <b>${params.expiry}</b></p>
          <p>Login at the portal using your mobile number and this code.</p>
          <p style="color:#8899bb">Support: 8437686541 — Naman Sir's Team</p>
        </div>`,
    });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

interface ReceiptEmailParams {
  to: string;
  name: string;
  receiptNo: string;
  courseTitle: string;
  paymentLabel: string;
  amount: string;
  paidToDate: string;
  remaining: string;
  installmentsSummary: string;
  status: string;
  receiptUrl?: string;
}

/**
 * Sends a payment-receipt confirmation email via Resend (optional, best-effort).
 * Silently skips when no RESEND_API_KEY is set. Never throws.
 */
export async function sendReceiptEmail(params: ReceiptEmailParams): Promise<{ sent: boolean }> {
  if (!EMAIL_ENABLED || !params.to) return { sent: false };
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY as string);
    await resend.emails.send({
      from: "Naman IAS Academy <noreply@namanias.com>",
      to: params.to,
      subject: `Payment receipt ${params.receiptNo} — ${params.courseTitle}`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;background:#0a1a3f;color:#e8e8f0;padding:24px;border-radius:12px">
          <h2 style="color:#d4af37">Payment received — thank you, ${params.name}!</h2>
          <p><b>${params.courseTitle}</b></p>
          <p>${params.paymentLabel}: <b style="color:#d4af37">${params.amount}</b> (GST included)</p>
          <hr style="border-color:#1e3a8a"/>
          <p style="margin:4px 0">Total paid to date: <b>${params.paidToDate}</b></p>
          <p style="margin:4px 0">Remaining balance: <b>${params.remaining}</b></p>
          <p style="margin:4px 0">Installments: ${params.installmentsSummary}</p>
          <p style="margin:4px 0">Status: <b>${params.status}</b></p>
          <p style="margin:4px 0">Receipt no: <span style="font-family:monospace">${params.receiptNo}</span></p>
          ${params.receiptUrl ? `<p><a href="${params.receiptUrl}" style="color:#d4af37">View / download your receipt →</a></p>` : ""}
          <p style="color:#8899bb;margin-top:16px">This is a system-generated receipt. Support: 8437686541 — Naman Sir's Team</p>
        </div>`,
    });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}
