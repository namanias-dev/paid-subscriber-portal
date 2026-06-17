import { NextResponse } from "next/server";
import { STUDENT_COOKIE } from "@/lib/config";

export async function POST() {
  try {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(STUDENT_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
