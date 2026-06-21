import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuizBySlug, getQuizQuestions, getEnrollments } from "@/lib/dataProvider";
import { getStudentSession } from "@/lib/session";
import { checkQuizAccess } from "@/lib/quizAccess";
import { sanitizeHtml } from "@/lib/sanitizeHtml";

export const dynamic = "force-dynamic";

export default async function StudentQuizIntro({ params }: { params: { slug: string } }) {
  const quiz = await getQuizBySlug(params.slug);
  if (!quiz) notFound();
  const session = await getStudentSession();
  const enrollments = session ? await getEnrollments(session.student_id) : [];
  const access = checkQuizAccess(quiz, session, enrollments);
  const quizQuestions = await getQuizQuestions(quiz.id);
  const totalMarks = quizQuestions.reduce((s, qq) => s + (qq.marks ?? quiz.marks_per_question), 0);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard/quizzes" className="text-sm text-primary">← Back to Quizzes</Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {quiz.subject && <span className="pill pill-blue">{quiz.subject}</span>}
        <span className="pill pill-gray">{quiz.difficulty}</span>
        {quiz.requires_payment && <span className="pill pill-amber">Paid</span>}
      </div>
      <h1 className="mt-2 font-heading text-2xl font-extrabold">{quiz.title}</h1>
      {quiz.description && <p className="mt-1 text-ink2">{quiz.description}</p>}

      <div className="card mt-5 grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <div><p className="font-heading text-xl font-extrabold">{quizQuestions.length}</p><p className="text-xs text-muted">Questions</p></div>
        <div><p className="font-heading text-xl font-extrabold">{totalMarks}</p><p className="text-xs text-muted">Marks</p></div>
        <div><p className="font-heading text-xl font-extrabold">{quiz.time_limit_minutes || "—"}</p><p className="text-xs text-muted">Minutes</p></div>
        <div><p className="font-heading text-xl font-extrabold">{quiz.negative_marking_enabled ? `-${quiz.negative_fraction}` : "0"}</p><p className="text-xs text-muted">Negative</p></div>
      </div>

      <div className="card mt-5 p-5">
        <h2 className="font-heading text-lg font-bold">Instructions</h2>
        {quiz.instructions_html ? (
          <div className="mt-2 text-sm leading-relaxed text-ink2" dangerouslySetInnerHTML={{ __html: sanitizeHtml(quiz.instructions_html) }} />
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink2">
            <li>Single-correct MCQ. Marks: {quiz.marks_per_question} per question.</li>
            {quiz.negative_marking_enabled && <li>Negative marking applies for wrong answers.</li>}
            {quiz.time_limit_minutes && <li>Auto-submits when the {quiz.time_limit_minutes}-minute timer ends.</li>}
            <li>Answers are auto-saved. You can resume if you close the tab.</li>
          </ul>
        )}
      </div>

      <div className="mt-6">
        {access.ok ? (
          <Link href={`/dashboard/quizzes/${quiz.slug}/attempt`} className="btn btn-primary w-full py-3 text-base">Start Test →</Link>
        ) : (
          <div className="card p-5 text-center">
            <p className="text-ink2">{access.message || "You don't have access to this test."}</p>
            <Link href="/courses" className="btn btn-primary mt-3">View Courses</Link>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-muted">UPSC Prelims-style practice test by Naman IAS Academy. Not an official UPSC document.</p>
    </div>
  );
}
