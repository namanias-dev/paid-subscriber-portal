import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getQuizBySlug } from "@/lib/dataProvider";
import { resolveLearner } from "@/lib/entitlements";
import PublicQuizAttempt from "@/components/public/quiz/PublicQuizAttempt";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function QuizAttemptPage({ params }: { params: { slug: string } }) {
  const quiz = await getQuizBySlug(params.slug);
  if (!quiz) notFound();
  // Any logged-in learner (course buyer OR LMS student) skips the lead form —
  // their profile is used automatically and the attempt is tracked to it.
  // A logged-out visitor ALWAYS sees the lead form (which creates their account
  // and logs them in) — anonymous attempts are never allowed.
  const learner = await resolveLearner();

  return (
    <PublicQuizAttempt
      slug={params.slug}
      quizTitle={quiz.title}
      isLoggedIn={!!learner}
    />
  );
}
