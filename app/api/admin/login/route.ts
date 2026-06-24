import { NextResponse } from "next/server";
import { verifyAdminCredentials } from "@/lib/dataProvider";
import { signAdminToken } from "@/lib/auth";
import { ADMIN_COOKIE, SESSION_MAX_AGE } from "@/lib/config";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: "Enter username and password." },
        { status: 400 }
      );
    }

    const admin = await verifyAdminCredentials(username, password);
    if (!admin) {
      return NextResponse.json(
        { ok: false, error: "Invalid admin credentials." },
        { status: 401 }
      );
    }

    const token = await signAdminToken({
      admin_id: admin.id,
      username: admin.username,
      role: admin.role,
      role_name: admin.role_name,
      permissions: admin.permissions,
      must_change_password: admin.must_change_password,
    });
    const res = NextResponse.json({ ok: true, username: admin.username, must_change_password: admin.must_change_password });
    res.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
