import { NextResponse } from "next/server";
import { registerWebinar } from "@/lib/dataProvider";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const webinarId = String(body.webinar_id || "");
    if (!name || phone.length !== 10 || !webinarId) {
      return NextResponse.json({ ok: false, error: "Valid name, mobile and webinar required." }, { status: 400 });
    }
    await registerWebinar(webinarId, name, phone);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not register." }, { status: 500 });
  }
}
