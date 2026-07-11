import { NextResponse } from "next/server";
import { verifyCredentials } from "@/lib/auth";
import { signSession, AIVA_COOKIE, sessionCookieOptions } from "@/lib/session";
import { flags } from "@/lib/flags";
import { hasAuth } from "@/lib/env";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!flags.enabled) return NextResponse.json({ ok: false, error: "AIVA is disabled." }, { status: 503 });
  if (!hasAuth()) return NextResponse.json({ ok: false, error: "AIVA auth is not configured." }, { status: 500 });

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const username = (body.username || "").trim();
  const password = body.password || "";
  if (!username || !password) return NextResponse.json({ ok: false, error: "Username and password required." }, { status: 400 });

  const result = await verifyCredentials(username, password);
  if (!result.ok) {
    await writeAudit({ actor_username: username, action: "auth:login", outcome: "blocked", reason: result.code });
    const status = result.code === "not_super" ? 403 : 401;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  const token = await signSession({
    admin_id: result.admin_id,
    username: result.username,
    name: result.name,
    role_id: result.role_id,
    is_super: true,
  });

  await writeAudit({ actor_id: result.admin_id, actor_username: result.username, action: "auth:login", outcome: "allowed" });

  const res = NextResponse.json({ ok: true, name: result.name || result.username });
  res.cookies.set(AIVA_COOKIE, token, sessionCookieOptions());
  return res;
}
