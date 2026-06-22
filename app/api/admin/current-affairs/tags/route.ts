import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getCaTags, addCaTag } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const tags = await getCaTags();
  return NextResponse.json({ ok: true, tags });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.name) return NextResponse.json({ ok: false, error: "Name required." }, { status: 400 });
  const tag = await addCaTag(body);
  return NextResponse.json({ ok: true, tag });
}
