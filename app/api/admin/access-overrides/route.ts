import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { upsertAccessOverride, deleteAccessOverride, getAllAccessOverrides } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/** Manual per-learner per-course access override (grant / extend / revoke). Always wins. */
export async function GET() {
  if (!(await getAdminSession())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const overrides = await getAllAccessOverrides();
  return NextResponse.json({ ok: true, overrides });
}

export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone || "").trim();
  const courseId = String(body.course_id || "");
  const mode = body.mode === "revoke" ? "revoke" : "grant";
  if (!phone || !courseId) return NextResponse.json({ ok: false, error: "phone and course_id required" }, { status: 400 });

  await upsertAccessOverride({
    phone,
    course_id: courseId,
    mode,
    expires_at: body.expires_at ? String(body.expires_at) : null,
    note: body.note ? String(body.note) : null,
    created_by: session.username || "admin",
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await getAdminSession())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone") || "";
  const courseId = url.searchParams.get("course_id") || "";
  if (!phone || !courseId) return NextResponse.json({ ok: false, error: "phone and course_id required" }, { status: 400 });
  await deleteAccessOverride(phone, courseId);
  return NextResponse.json({ ok: true });
}
