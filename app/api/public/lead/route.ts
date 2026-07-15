import { NextResponse } from "next/server";
import { addLead } from "@/lib/dataProvider";
import { normalizeIndianMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const phoneNorm = normalizeIndianMobile(String(body.phone || ""));
    if (!name) {
      return NextResponse.json({ ok: false, error: "Please enter your name." }, { status: 400 });
    }
    if (!phoneNorm.ok) {
      return NextResponse.json({ ok: false, error: phoneNorm.error || "Enter a valid 10-digit mobile." }, { status: 400 });
    }

    const emailRaw = String(body.email || "").trim();
    if (emailRaw && !EMAIL_RE.test(emailRaw)) {
      return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
    }

    // source_form: which form this came from (for Journey Automation trigger
    // filtering). Defaults to the generic website form when unspecified.
    const sourceForm = body.source_form ? String(body.source_form) : "public_lead_form";
    const lead = await addLead({
      name,
      phone: phoneNorm.digits10,
      email: emailRaw || null,
      city: body.city ? String(body.city) : null,
      source: body.source ? String(body.source) : "Website",
      campaign: body.campaign ? String(body.campaign) : null,
      course_interest: body.course_interest ? String(body.course_interest) : null,
    }, sourceForm);
    return NextResponse.json({ ok: true, id: lead.id });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not submit. Please try again." }, { status: 500 });
  }
}
