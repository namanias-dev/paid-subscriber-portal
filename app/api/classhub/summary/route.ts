import { NextResponse } from "next/server";
import { resolveLearner } from "@/lib/entitlements";
import { getNewCountsForLearner } from "@/lib/classHubServer";

export const dynamic = "force-dynamic";

/**
 * Per-course "new content" counts for the current learner — powers the subtle
 * gold dot on Class Hub / My Courses entry points. Reuses the same assembly +
 * gating as the Class Hub itself, so counts never contradict what's shown.
 */
export async function GET() {
  try {
    const learner = await resolveLearner();
    const counts = await getNewCountsForLearner(learner);
    return NextResponse.json({ ok: true, counts });
  } catch {
    return NextResponse.json({ ok: true, counts: {} });
  }
}
