import { NextResponse } from "next/server";
import { findBuyerByLogin, rateLimited } from "@/lib/dataProvider";
import { signBuyerToken } from "@/lib/auth";
import { BUYER_COOKIE } from "@/lib/config";
import { normalizeIndianMobile } from "@/lib/phone";
import { normalizeLoginCode } from "@/lib/buyerCode";

export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const n = normalizeIndianMobile(body.phone);
    const code = normalizeLoginCode(body.code);
    if (!n.ok || !n.digits10 || !code) {
      return NextResponse.json({ ok: false, error: "Enter your mobile number and login code." }, { status: 400 });
    }
    const phone = n.digits10;
    const ip = clientIp(req);

    // Convenience-grade rate-limiting (per phone + per IP). Generic message — no account-existence leak.
    if ((await rateLimited(`login:${phone}`, 8, 600)) || (await rateLimited(`login-ip:${ip}`, 40, 600))) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
    }

    const buyer = await findBuyerByLogin(phone, code);
    if (!buyer) {
      return NextResponse.json(
        { ok: false, error: "We couldn't verify those details. Please double-check your mobile number and login code." },
        { status: 401 }
      );
    }

    const token = await signBuyerToken({ buyer_id: buyer.id, phone: buyer.phone, name: buyer.name });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(BUYER_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "Login failed. Please try again." }, { status: 500 });
  }
}
