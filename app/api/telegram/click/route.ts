import { NextResponse } from "next/server";
import { recordButtonClick } from "@/lib/telegram/answers";

export const dynamic = "force-dynamic";

/**
 * Public click tracker for Telegram URL buttons.
 * GET ?b=&l=&u=&c= → record click then 302 redirect to u
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const b = url.searchParams.get("b");
  const l = url.searchParams.get("l");
  const u = url.searchParams.get("u");
  const c = url.searchParams.get("c");

  if (!u) {
    return NextResponse.json({ ok: false, error: "u_required" }, { status: 400 });
  }

  let target: string;
  try {
    target = decodeURIComponent(u);
  } catch {
    target = u;
  }

  // Basic open-redirect guard: only http(s)
  if (!/^https?:\/\//i.test(target)) {
    return NextResponse.json({ ok: false, error: "invalid_url" }, { status: 400 });
  }

  try {
    await recordButtonClick({
      broadcastId: b || null,
      chatId: c || null,
      buttonLabel: l ? decodeURIComponent(l) : null,
      buttonUrl: target,
    });
  } catch {
    /* still redirect */
  }

  return NextResponse.redirect(target, 302);
}
