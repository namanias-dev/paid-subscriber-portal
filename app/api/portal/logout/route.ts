import { NextResponse } from "next/server";
import { BUYER_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(BUYER_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
