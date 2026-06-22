import { NextResponse } from "next/server";
import { toggleCaBookmark, isCaBookmarked, logCaEvent } from "@/lib/dataProvider";
import { getCurrentUserPhone } from "@/lib/caSession";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") || "";
  const phone = await getCurrentUserPhone();
  if (!phone) return NextResponse.json({ ok: true, loggedIn: false, bookmarked: false });
  const bookmarked = slug ? await isCaBookmarked(phone, slug) : false;
  return NextResponse.json({ ok: true, loggedIn: true, bookmarked });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = (body.slug || "").toString();
  if (!slug) return NextResponse.json({ ok: false, error: "Missing slug." }, { status: 400 });
  const phone = await getCurrentUserPhone();
  if (!phone) return NextResponse.json({ ok: false, requiresLogin: true, error: "Please log in to save." });
  const bookmarked = await toggleCaBookmark(phone, slug);
  if (bookmarked) void logCaEvent("cta_click", `bookmark:${slug}`);
  return NextResponse.json({ ok: true, bookmarked });
}
