import { NextResponse } from "next/server";
import { findStudentByLogin, touchStreakOnLogin, logAccess } from "@/lib/dataProvider";
import { signStudentToken } from "@/lib/auth";
import { STUDENT_COOKIE } from "@/lib/config";
import { isExpired, formatDate } from "@/lib/dates";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const phone = String(body.phone || "").trim();
    const code = String(body.code || "").trim().toUpperCase();

    if (!phone || !code) {
      return NextResponse.json(
        { ok: false, error: "Please enter both phone number and access code." },
        { status: 400 }
      );
    }

    const student = await findStudentByLogin(phone, code);
    if (!student) {
      return NextResponse.json(
        { ok: false, error: "Invalid code. Please check your phone and access code." },
        { status: 401 }
      );
    }

    if (isExpired(student.expiry_date)) {
      return NextResponse.json(
        {
          ok: false,
          expired: true,
          expiry_date: student.expiry_date,
          error: `Access expired on ${formatDate(student.expiry_date)} — renew here.`,
        },
        { status: 403 }
      );
    }

    const updated = await touchStreakOnLogin(student);
    await logAccess(student.id, "login");

    const token = await signStudentToken({
      student_id: updated.id,
      name: updated.name,
      plan: updated.plan,
      expiry_date: updated.expiry_date,
    });

    const res = NextResponse.json({
      ok: true,
      student: { id: updated.id, name: updated.name, plan: updated.plan },
    });
    res.cookies.set(STUDENT_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
