import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getCaCategories, addCaCategory } from "@/lib/dataProvider";
import { sanitizeHtml } from "@/lib/sanitizeHtml";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const categories = await getCaCategories();
  return NextResponse.json({ ok: true, categories });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.name) return NextResponse.json({ ok: false, error: "Name required." }, { status: 400 });
  if (typeof body.description === "string") body.description = sanitizeHtml(body.description) || null;
  const category = await addCaCategory(body);
  return NextResponse.json({ ok: true, category });
}
