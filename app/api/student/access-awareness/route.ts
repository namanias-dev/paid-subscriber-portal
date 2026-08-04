import { NextResponse } from "next/server";
import { resolveLearner } from "@/lib/entitlements";
import { getPrimaryAccessAwarenessForPhone } from "@/lib/accessAwarenessServer";

export const dynamic = "force-dynamic";

/** Primary access-awareness banner for the signed-in learner (dashboard / mobile). */
export async function GET(req: Request) {
  try {
    const learner = await resolveLearner();
    if (!learner?.phone) {
      return NextResponse.json({ ok: true, banner: null });
    }
    const url = new URL(req.url);
    const courseId = url.searchParams.get("courseId") || undefined;
    const banner = await getPrimaryAccessAwarenessForPhone(learner.phone, courseId);
    return NextResponse.json({ ok: true, banner });
  } catch {
    return NextResponse.json({ ok: true, banner: null });
  }
}
