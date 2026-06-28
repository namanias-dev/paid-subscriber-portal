import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getCaPdfs, addCaPdf } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("content_current_affairs"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const pdfs = await getCaPdfs();
  return NextResponse.json({ ok: true, pdfs });
}

export async function POST(req: Request) {
  if (!(await requirePermission("content_current_affairs"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.title) return NextResponse.json({ ok: false, error: "Title required." }, { status: 400 });
  const pdf = await addCaPdf(body);
  return NextResponse.json({ ok: true, pdf });
}
