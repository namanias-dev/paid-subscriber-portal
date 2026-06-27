import Link from "next/link";
import { redirect } from "next/navigation";
import { getBuyerSession } from "@/lib/session";
import { resolveLearner } from "@/lib/entitlements";
import { getAttemptsByUser, getAllQuizzes } from "@/lib/dataProvider";
import { formatISTDateTime } from "@/lib/dates";
import type { QuizAttempt } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "My Tests — Naman Sharma IAS Academy",
  robots: { index: false, follow: false },
};

type Kind = "completed" | "in_progress" | "ended";

function attemptKind(a: QuizAttempt): Kind {
  if (a.status === "SUBMITTED" || a.status === "AUTO_SUBMITTED") return "completed";
  if (a.status === "IN_PROGRESS") return "in_progress";
  return "ended"; // EXPIRED / ABANDONED
}

const KIND_PILL: Record<Kind, { label: string; cls: string }> = {
  completed: { label: "Completed", cls: "pill-green" },
  in_progress: { label: "In progress", cls: "pill-amber" },
  ended: { label: "Not finished", cls: "pill-gray" },
};

export default async function PortalQuizzesPage() {
  const session = await getBuyerSession();
  if (!session) redirect("/portal/login");

  const learner = await resolveLearner();

  // Show ONLY genuinely-owned attempts: those CLAIMED to this learner's student id.
  // Pre-login guest attempts are claimed (code-proven) to that id at login, so this
  // covers cross-device history WITHOUT ever listing by a self-reported phone — a
  // typo'd/shared number can therefore never surface another person's results here.
  const [byUser, quizzes] = await Promise.all([
    learner?.studentId ? getAttemptsByUser(learner.studentId) : Promise.resolve([] as QuizAttempt[]),
    getAllQuizzes(),
  ]);

  const map = new Map<string, QuizAttempt>();
  for (const a of byUser) map.set(a.id, a);
  const attempts = [...map.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const quizById = new Map(quizzes.map((q) => [q.id, q]));

  return (
    <div className="container-wide section">
      <Link href="/portal" className="text-sm text-primary">← My portal</Link>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pill pill-blue mb-3">My Tests</p>
          <h1 className="text-3xl font-extrabold sm:text-4xl">Your quiz history</h1>
          <p className="mt-2 text-ink2">Every test you&apos;ve taken — review results, resume, or retake as many times as you like.</p>
        </div>
        <Link href="/quizzes" className="btn btn-secondary text-sm">Browse tests →</Link>
      </div>

      {attempts.length === 0 ? (
        <div className="mt-8 card p-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary-tint text-2xl">📝</div>
          <h2 className="text-xl font-bold">No tests yet</h2>
          <p className="mt-2 text-sm text-ink2">Take a free practice test to see your results and track your progress here.</p>
          <Link href="/quizzes" className="btn btn-primary mt-5">Take a test →</Link>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {attempts.map((a) => {
            const quiz = quizById.get(a.quiz_id);
            const slug = quiz?.slug;
            const kind = attemptKind(a);
            const pill = KIND_PILL[kind];
            return (
              <div key={a.id} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-semibold">{quiz?.title || "Quiz"}</h3>
                    <span className={`pill text-xs ${pill.cls}`}>{pill.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{formatISTDateTime(a.created_at)}</p>
                  {kind === "completed" && (
                    <p className="mt-1 text-sm text-ink2">
                      Score <span className="font-semibold text-ink">{a.score}</span> / {a.max_score}
                      {typeof a.accuracy === "number" && a.accuracy > 0 && (
                        <span className="text-muted"> · {Math.round(a.accuracy)}% accuracy</span>
                      )}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {!slug ? (
                    <span className="text-xs text-muted">Test no longer available</span>
                  ) : kind === "completed" ? (
                    <>
                      <Link href={`/quizzes/${slug}/result/${a.id}`} className="btn btn-secondary text-sm">View result</Link>
                      <Link href={`/quizzes/${slug}/attempt`} className="btn btn-primary text-sm">Retake</Link>
                    </>
                  ) : kind === "in_progress" ? (
                    <Link href={`/quizzes/${slug}/attempt`} className="btn btn-primary text-sm">Resume</Link>
                  ) : (
                    <Link href={`/quizzes/${slug}/attempt`} className="btn btn-primary text-sm">Retake</Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
