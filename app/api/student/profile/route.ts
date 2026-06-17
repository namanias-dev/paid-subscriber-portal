import { NextResponse } from "next/server";
import { getStudentById, updateStudent } from "@/lib/dataProvider";
import { getStudentSession } from "@/lib/session";
import type { Student } from "@/lib/types";

export async function GET() {
  try {
    const session = await getStudentSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const student = await getStudentById(session.student_id);
    if (!student) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, student });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getStudentSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const patch: Partial<Student> = {};
    if (body.target_year !== undefined) {
      patch.target_year = body.target_year ? Number(body.target_year) : null;
    }
    if (body.optional_subject !== undefined) {
      patch.optional_subject = body.optional_subject
        ? String(body.optional_subject)
        : null;
    }
    const updated = await updateStudent(session.student_id, patch);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, student: updated });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update." }, { status: 500 });
  }
}
