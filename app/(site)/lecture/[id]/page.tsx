import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, LogIn } from "lucide-react";
import { getContentById, getLectureProgress } from "@/lib/dataProvider";
import { resolveLectureAccess } from "@/lib/entitlements";
import { r2Configured, signGetUrl } from "@/lib/r2";
import { formatISTDate } from "@/lib/dates";
import LecturePlayer from "@/components/lecture/LecturePlayer";

export const dynamic = "force-dynamic";

export default async function LecturePage({ params }: { params: { id: string } }) {
  const rec = await getContentById(params.id);
  if (!rec || rec.source_type !== "hosted" || !rec.is_published || rec.upload_status !== "completed") notFound();

  const { learner, access } = await resolveLectureAccess(rec);

  if (!access.allowed) {
    return (
      <div className="container-wide section">
        <Link href="/dashboard/my-courses" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink2 hover:text-primary">
          <ArrowLeft size={15} /> Back
        </Link>
        <div className="mx-auto mt-8 max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-surface2 text-ink2">
            {access.reason === "login" ? <LogIn size={24} /> : <Lock size={24} />}
          </div>
          {access.reason === "login" ? (
            <>
              <h1 className="mt-4 font-heading text-xl font-bold">Log in to watch this lecture</h1>
              <p className="mt-1 text-sm text-ink2">This recording is available to enrolled students.</p>
              <Link href="/login" className="btn btn-primary mt-5">Log in</Link>
            </>
          ) : access.reason === "overdue" ? (
            <>
              <h1 className="mt-4 font-heading text-xl font-bold">Complete your pending installment to continue</h1>
              <p className="mt-1 text-sm text-ink2">
                Your access is paused after the grace period{access.amountDue ? ` — ₹${access.amountDue.toLocaleString("en-IN")} due` : ""}. Your progress is saved.
              </p>
              <Link href="/portal" className="btn btn-primary mt-5">Pay pending installment</Link>
            </>
          ) : access.reason === "expired" ? (
            <>
              <h1 className="mt-4 font-heading text-xl font-bold">Your access has ended</h1>
              <p className="mt-1 text-sm text-ink2">Renew to regain access to this batch&apos;s recordings.</p>
              <Link href="/portal" className="btn btn-primary mt-5">Renew access</Link>
            </>
          ) : (
            <>
              <h1 className="mt-4 font-heading text-xl font-bold">This lecture is locked</h1>
              <p className="mt-1 text-sm text-ink2">Contact support if you believe this is an error.</p>
              <Link href="/contact" className="btn btn-secondary mt-5">Contact support</Link>
            </>
          )}
        </div>
      </div>
    );
  }

  const [progress, notesUrl] = await Promise.all([
    learner?.studentId ? getLectureProgress(learner.studentId, rec.id) : Promise.resolve(null),
    rec.notes_pdf_key && r2Configured() ? signGetUrl(rec.notes_pdf_key, 3600).catch(() => null) : Promise.resolve(null),
  ]);

  const courseId = (rec.course_ids && rec.course_ids[0]) || rec.course_id || "";
  const backHref = courseId ? `/dashboard/class/${courseId}` : "/dashboard/my-courses";

  return (
    <div className="container-wide section">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink2 hover:text-primary">
        <ArrowLeft size={15} /> Back to Class Hub
      </Link>
      <LecturePlayer
        recordingId={rec.id}
        title={rec.title}
        subject={rec.subject}
        topic={rec.paper}
        dateLabel={rec.date ? formatISTDate(rec.date) : null}
        durationSeconds={rec.duration_seconds ?? null}
        initialPosition={progress?.last_position_seconds ?? 0}
        notesUrl={notesUrl}
        backHref={backHref}
        watermark={learner ? `${learner.name}${learner.phone ? ` · ${learner.phone}` : ""} · Naman IAS Academy` : null}
      />
    </div>
  );
}
