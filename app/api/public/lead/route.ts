import { NextResponse } from "next/server";
import { addLead } from "@/lib/dataProvider";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").replace(/\D/g, "");
    if (!name || phone.length !== 10) {
      return NextResponse.json({ ok: false, error: "Valid name and 10-digit mobile required." }, { status: 400 });
    }
    const lead = await addLead({
      name,
      phone,
      city: body.city ? String(body.city) : null,
      source: body.source ? String(body.source) : "Website",
      campaign: body.campaign ? String(body.campaign) : null,
      course_interest: body.course_interest ? String(body.course_interest) : null,
    });
    return NextResponse.json({ ok: true, id: lead.id });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not submit. Please try again." }, { status: 500 });
  }
}
