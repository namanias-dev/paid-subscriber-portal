import { NextResponse } from "next/server";
import { getContentById, upsertLectureProgress } from "@/lib/dataProvider";
import { resolveLectureAccess } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

/** Save resume position / completion for the authenticated learner only. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const rec = await getContentById(params.id);
  if (!rec || rec.source_type !== "hosted") return NextResponse.json({ ok: false }, { status: 404 });

  const { learner, access } = await resolveLectureAccess(rec);
  if (!learner?.studentId || !access.allowed) return NextResponse.json({ ok: true }); // no-op for guests/blocked

  const body = await req.json().catch(() => ({}));
  const pos = Number(body.position);
  await upsertLectureProgress(learner.studentId, rec.id, {
    last_position_seconds: Number.isFinite(pos) && pos >= 0 ? pos : undefined,
    completed: body.completed === true,
    durationSeconds: rec.duration_seconds ?? null,
  });
  return NextResponse.json({ ok: true });
}
