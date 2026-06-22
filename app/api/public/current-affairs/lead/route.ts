import { NextResponse } from "next/server";
import { addCaLead, rateLimited, logCaEvent } from "@/lib/dataProvider";
import { normalizeIndianMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const n = normalizeIndianMobile(body.phone);
    if (!n.ok) return NextResponse.json({ ok: false, error: n.error }, { status: 400 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    if (await rateLimited(`ca-lead:${ip}`, 8, 600)) {
      return NextResponse.json({ ok: false, error: "Too many requests. Please try again later." }, { status: 429 });
    }

    await addCaLead({
      phone: n.e164!,
      name: (body.name || "").toString().trim() || null,
      city: (body.city || "").toString().trim() || null,
      source: (body.source || "current-affairs").toString().slice(0, 80),
      target_year: (body.target_year || "").toString().trim() || null,
      interested_course: (body.interested_course || "").toString().trim() || null,
    });
    void logCaEvent("lead", (body.source || "").toString().slice(0, 80));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
