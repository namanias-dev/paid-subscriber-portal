import { NextResponse } from "next/server";
import { AIVA_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AIVA_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
