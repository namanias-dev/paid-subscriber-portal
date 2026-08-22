import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import { logAccess } from "@/lib/dataProvider";
import { logAdminActivity } from "@/lib/adminActivity";
import { executeStudentRemoval, previewStudentRemoval } from "@/lib/studentRemoval";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function gate(): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const session = await getAdminSession();
  if (!session) return { ok: false, status: 401 };
  if (!(await requirePermission("manage_students_leads"))) return { ok: false, status: 403 };
  return { ok: true };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await gate();
  if (!auth.ok) return json({ ok: false, error: auth.status === 401 ? "Unauthorized" : "Forbidden" }, auth.status);
  const preview = await previewStudentRemoval(params.id);
  if (!preview) return json({ ok: false, error: "Not found" }, 404);
  return json({ ok: true, preview });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await gate();
  if (!auth.ok) return json({ ok: false, error: auth.status === 401 ? "Unauthorized" : "Forbidden" }, auth.status);
  const body = await req.json().catch(() => ({}));
  const confirmPhone = String(body.confirmPhone || "");
  const forceHardDelete = !!body.forceHardDelete;
  const confirmWord = String(body.confirmWord || "");
  const result = await executeStudentRemoval({ studentId: params.id, confirmPhone, forceHardDelete, confirmWord });
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  const actor = await getActionActor();
  const p = result.preview;
  await logAccess(
    result.path === "archive" ? params.id : null,
    `admin:${result.path === "archive" ? "archive" : "hard-delete"} student ${p.name} ${p.phone} (by ${actor?.name || "admin"})`,
  );
  await logAdminActivity({
    actor,
    action: result.path === "archive" ? "student_archived" : "student_hard_deleted",
    entityType: "student",
    entityId: params.id,
    metadata: {
      name: p.name,
      phone: p.phone,
      login_code: p.loginCode,
      path: result.path,
      enrollments: p.enrollments.map((e) => e.title),
      payment_count: p.paymentCount,
      proof_count: p.proofCount,
    },
  });
  return json({ ok: true, path: result.path, preview: p });
}
