import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getQuizBySlug, getSiteSettings } from "@/lib/dataProvider";
import { resolveLearner } from "@/lib/entitlements";
import PublicQuizAttempt from "@/components/public/quiz/PublicQuizAttempt";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function QuizAttemptPage({ params }: { params: { slug: string } }) {
  const [quiz, settings] = await Promise.all([getQuizBySlug(params.slug), getSiteSettings()]);
  if (!quiz) notFound();
  // Any logged-in learner (course buyer OR LMS student) skips the lead form —
  // their profile is used automatically and the attempt is tracked to it.
  const learner = await resolveLearner();

  // Global lead gate (default ON) OR per-quiz override both require the form.
  const captureLead =
    settings.content.quiz_lead_gate !== false ||
    quiz.result_settings?.capture_lead_before_result === true;

  return (
    <PublicQuizAttempt
      slug={params.slug}
      quizTitle={quiz.title}
      captureLead={captureLead}
      isLoggedIn={!!learner}
    />
  );
}
