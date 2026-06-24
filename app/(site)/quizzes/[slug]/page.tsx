import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, CheckCircle2 } from "lucide-react";
import { getQuizBySlug, getQuizQuestions, getAllCourses } from "@/lib/dataProvider";
import { SITE_URL } from "@/lib/config";
import { quizIsLive } from "@/lib/quizAccess";
import { resolveLearner, gateQuiz } from "@/lib/entitlements";
import { getAttemptStatusForLearner } from "@/lib/quizAttemptStatus";
import { sanitizeHtml } from "@/lib/sanitizeHtml";
import QuizAttemptActions from "@/components/public/quiz/QuizAttemptActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const quiz = await getQuizBySlug(params.slug);
  if (!quiz) return { title: "Quiz not found" };
  const seo = quiz.seo || {};
  const title = seo.seo_title || `${quiz.title} | UPSC Prelims-style Practice | Naman IAS Academy`;
  const description = seo.seo_description || quiz.description || `Attempt this UPSC Prelims-style ${quiz.subject || ""} practice test with instant results and explanations.`;
  const indexable = seo.indexable !== false && quiz.is_public && quiz.status === "published";
  return {
    title,
    description,
    keywords: seo.seo_keywords,
    alternates: { canonical: seo.canonical_url || `${SITE_URL}/quizzes/${quiz.slug}` },
    robots: indexable ? undefined : { index: false, follow: false },
    openGraph: {
      title: seo.og_title || title,
      description: seo.og_description || description,
      url: `${SITE_URL}/quizzes/${quiz.slug}`,
      images: seo.og_image || quiz.thumbnail ? [{ url: (seo.og_image || quiz.thumbnail)! }] : undefined,
      type: "website",
    },
  };
}

export default async function QuizIntroPage({ params }: { params: { slug: string } }) {
  const quiz = await getQuizBySlug(params.slug);
  if (!quiz) notFound();
  if (!quiz.is_public && quiz.requires_login) {
    // Private quizzes are handled in the student portal.
  }

  const [quizQuestions, courses, learner] = await Promise.all([
    getQuizQuestions(quiz.id),
    getAllCourses(),
    resolveLearner(),
  ]);
  const live = quizIsLive(quiz);
  const totalMarks = quizQuestions.reduce((sum, qq) => sum + (qq.marks ?? quiz.marks_per_question), 0);
  const seo = quiz.seo || {};

  // Central entitlement decision — drives the locked/unlocked CTA below.
  const gate = gateQuiz(quiz, learner, courses);
  const unlockCourses = courses.filter((c) => gate.unlockCourseIds.includes(c.id));
  const lockedPaid = !gate.free && !gate.allowed;
  const entitledPaid = !gate.free && gate.allowed;

  // Already-attempted? Show ✓ score + report/PDF (reusing the free-quiz report).
  const attemptMap = await getAttemptStatusForLearner(learner);
  const attempt = attemptMap[quiz.id];
  const retakeAllowed = !(quiz.max_attempts && attempt && attempt.attemptCount >= quiz.max_attempts && quiz.attempt_settings?.retry_allowed === false);

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Quiz",
    name: quiz.title,
    educationalLevel: "UPSC Civil Services Prelims",
    about: quiz.subject || "UPSC Prelims",
    url: `${SITE_URL}/quizzes/${quiz.slug}`,
    numberOfQuestions: quizQuestions.length,
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Quizzes", item: `${SITE_URL}/quizzes` },
      { "@type": "ListItem", position: 2, name: quiz.title, item: `${SITE_URL}/quizzes/${quiz.slug}` },
    ],
  };
  const faqLd = seo.faq && seo.faq.length ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: seo.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  } : null;

  return (
    <div className="container-narrow py-10">
      {seo.structured_data_enabled !== false && (
        <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
          {faqLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />}
        </>
      )}

      <Link href="/quizzes" className="text-sm text-primary">← All Quizzes</Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`pill ${quiz.requires_payment ? "pill-amber" : "pill-green"}`}>{quiz.requires_payment ? "Paid" : "Free"}</span>
        {quiz.subject && <span className="pill pill-blue">{quiz.subject}</span>}
        <span className="pill pill-gray">{quiz.difficulty}</span>
      </div>
      <h1 className="mt-3 font-heading text-3xl font-extrabold">{quiz.title}</h1>
      {quiz.description && <p className="mt-2 text-ink2">{quiz.description}</p>}

      <div className="card mt-6 grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <div><p className="font-heading text-2xl font-extrabold">{quizQuestions.length}</p><p className="text-xs text-muted">Questions</p></div>
        <div><p className="font-heading text-2xl font-extrabold">{totalMarks}</p><p className="text-xs text-muted">Marks</p></div>
        <div><p className="font-heading text-2xl font-extrabold">{quiz.time_limit_minutes || "—"}</p><p className="text-xs text-muted">Minutes</p></div>
        <div><p className="font-heading text-2xl font-extrabold">{quiz.negative_marking_enabled ? `-${quiz.negative_fraction}` : "0"}</p><p className="text-xs text-muted">Negative</p></div>
      </div>

      <div className="card mt-6 p-5">
        <h2 className="font-heading text-lg font-bold">Instructions</h2>
        {quiz.instructions_html ? (
          <div className="prose-quiz mt-2 text-sm leading-relaxed text-ink2" dangerouslySetInnerHTML={{ __html: sanitizeHtml(quiz.instructions_html) }} />
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink2">
            <li>Single-correct MCQ. Marks: {quiz.marks_per_question} per question.</li>
            {quiz.negative_marking_enabled && <li>Negative marking applies for wrong answers.</li>}
            {quiz.time_limit_minutes && <li>The test auto-submits when the {quiz.time_limit_minutes}-minute timer ends.</li>}
            <li>Your answers are saved automatically. You can mark questions for review.</li>
          </ul>
        )}
      </div>

      {seo.public_summary && (
        <div className="prose-quiz card mt-6 p-5 text-sm leading-relaxed text-ink2" dangerouslySetInnerHTML={{ __html: sanitizeHtml(seo.public_summary) }} />
      )}

      {entitledPaid && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-3 text-sm font-semibold text-success">
          <CheckCircle2 size={18} aria-hidden="true" /> Unlocked — you&apos;re enrolled in a course that includes this test.
        </div>
      )}

      <div className="sticky bottom-4 mt-6">
        {attempt ? (
          <div className="card border-success/30 bg-success/5 p-5 shadow-lg">
            <QuizAttemptActions
              slug={quiz.slug}
              status={attempt}
              retakeHref={live && !lockedPaid && retakeAllowed ? `/quizzes/${quiz.slug}/attempt` : null}
            />
          </div>
        ) : !live ? (
          <div className="btn btn-secondary w-full cursor-not-allowed py-3 text-base opacity-70">This test isn&apos;t available right now</div>
        ) : lockedPaid ? (
          <div className="card border-amber-200 bg-amber-50/60 p-5 shadow-lg">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <Lock size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-heading text-base font-bold text-ink">Premium test</p>
                <p className="mt-0.5 text-sm text-ink2">
                  {gate.reason === "login"
                    ? "Log in with your enrolled account to take this test."
                    : gate.reason === "expired"
                    ? "Your access has expired. Renew to continue."
                    : unlockCourses.length
                    ? `Unlock by enrolling in ${unlockCourses.map((c) => c.title).join(" or ")}.`
                    : "Enrol in a course that includes this test to unlock it."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {gate.reason === "login" && (
                    <Link href={`/portal/login?next=/quizzes/${quiz.slug}`} className="btn btn-primary text-sm">Log in</Link>
                  )}
                  {gate.reason === "expired" && (
                    <Link href="/portal" className="btn btn-primary text-sm">Renew access</Link>
                  )}
                  {unlockCourses.slice(0, 2).map((c) => (
                    <Link key={c.id} href={`/courses/${c.slug}`} className="btn btn-secondary text-sm">View {c.title} →</Link>
                  ))}
                  {!unlockCourses.length && gate.reason === "payment" && (
                    <Link href="/courses" className="btn btn-secondary text-sm">Browse courses →</Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <Link href={`/quizzes/${quiz.slug}/attempt`} className="btn btn-primary w-full py-3 text-base shadow-lg">Start Test →</Link>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-muted">UPSC Prelims-style practice test by Naman IAS Academy. Not an official UPSC document.</p>
    </div>
  );
}
