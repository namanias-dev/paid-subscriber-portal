import { NextResponse } from "next/server";
import { getCaPdfById, incrementCaPdfDownload, addCaLead, logCaEvent, rateLimited, getPublishedArticlePdfIds, isPublicCaPdf } from "@/lib/dataProvider";
import { getCurrentUserPhone } from "@/lib/caSession";
import { normalizeIndianMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const pdf = await getCaPdfById((body.id || "").toString());
    if (!pdf || !pdf.file_url) {
      return NextResponse.json({ ok: false, error: "This file isn't available yet." }, { status: 404 });
    }

    // Public-exposure gate: this endpoint serves the PUBLIC Downloads/article
    // surfaces only. Genuinely-free compilations (daily/monthly) and notes that
    // are attached to a published free article are allowed; class/paid-only
    // notes are rejected here so a logged-out/free user can never obtain the
    // file_url by guessing a direct id. Entitled students access their gated
    // notes through the separate courses/content system, which is untouched.
    const publishedArticlePdfIds = await getPublishedArticlePdfIds();
    if (!isPublicCaPdf(pdf, publishedArticlePdfIds)) {
      return NextResponse.json({ ok: false, error: "This file isn't available for public download." }, { status: 403 });
    }

    const sessionPhone = await getCurrentUserPhone();

    // Login gating.
    if (pdf.requires_login && !sessionPhone) {
      return NextResponse.json({ ok: false, requiresLogin: true, error: "Please log in to download." });
    }

    // Lead gating (a phone unlocks it; logged-in users pass automatically).
    if (pdf.requires_lead && !sessionPhone) {
      const n = normalizeIndianMobile(body.phone);
      if (!n.ok) return NextResponse.json({ ok: false, requiresLead: true, error: n.error || "Enter your mobile number." });
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
      if (!(await rateLimited(`ca-pdf:${ip}`, 20, 600))) {
        await addCaLead({ phone: n.e164!, source: `ca-pdf:${pdf.id}` });
      }
    }

    void incrementCaPdfDownload(pdf.id);
    void logCaEvent("pdf_download", pdf.id);

    return NextResponse.json({ ok: true, url: pdf.file_url });
  } catch {
    return NextResponse.json({ ok: false, error: "Download failed." }, { status: 500 });
  }
}
