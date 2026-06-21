import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getQuizBySlug } from "@/lib/dataProvider";
import { getStudentSession } from "@/lib/session";
import PublicQuizAttempt from "@/components/public/quiz/PublicQuizAttempt";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function QuizAttemptPage({ params }: { params: { slug: string } }) {
  const quiz = await getQuizBySlug(params.slug);
  if (!quiz) notFound();
  const session = await getStudentSession();

  return (
    <PublicQuizAttempt
      slug={params.slug}
      captureLead={quiz.result_settings?.capture_lead_before_result === true}
      isLoggedIn={!!session}
    />
  );
}
