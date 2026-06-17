import { NextResponse } from "next/server";
import { updateStudent, deleteStudent, getStudentById } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { computeExpiry } from "@/lib/dates";
import type { Student } from "@/lib/types";

async function requireAdmin() {
  const session = await getAdminSession();
  return !!session;
}

const DAY = 86400000;

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const patch: Partial<Student> = {};

    // Special action: extend by N days (default 30)
    if (body.action === "extend") {
      const current = await getStudentById(params.id);
      if (!current) {
        return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
      }
      const days = Number(body.days) || 30;
      const base =
        current.expiry_date && new Date(current.expiry_date).getTime() > Date.now()
          ? new Date(current.expiry_date).getTime()
          : Date.now();
      patch.expiry_date = new Date(base + days * DAY).toISOString();
      patch.is_active = true;
    } else if (body.action === "revoke") {
      patch.is_active = false;
    } else {
      // generic edit
      if (body.name != null) patch.name = String(body.name);
      if (body.email != null) patch.email = body.email ? String(body.email) : null;
      if (body.phone != null) patch.phone = String(body.phone);
      if (body.target_year != null)
        patch.target_year = body.target_year ? Number(body.target_year) : null;
      if (body.optional_subject != null)
        patch.optional_subject = body.optional_subject
          ? String(body.optional_subject)
          : null;
      if (body.amount_paid != null) patch.amount_paid = Number(body.amount_paid);
      if (body.is_active != null) patch.is_active = Boolean(body.is_active);
      if (body.start_date != null) {
        patch.start_date = new Date(body.start_date).toISOString();
      }
      // Recompute expiry if start_date or months provided
      if (body.months != null || body.start_date != null) {
        const current = await getStudentById(params.id);
        const months = body.months != null ? Number(body.months) : current?.months ?? null;
        const start = patch.start_date || current?.start_date || new Date().toISOString();
        patch.months = months;
        patch.expiry_date = computeExpiry(start, months);
      }
    }

    const updated = await updateStudent(params.id, patch);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, student: updated });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to update student." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const ok = await deleteStudent(params.id);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to delete student." },
      { status: 500 }
    );
  }
}
