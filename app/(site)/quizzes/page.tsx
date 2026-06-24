import type { Metadata } from "next";
import Link from "next/link";
import { Quote } from "lucide-react";
import { getPublicQuizzes, getSiteSettings, getAllCourses } from "@/lib/dataProvider";
import { SITE_URL } from "@/lib/config";
import { DEFAULT_CONTENT } from "@/lib/homeDefaults";
import { resolveLearner, gateQuiz } from "@/lib/entitlements";
import { getAttemptStatusForLearner } from "@/lib/quizAttemptStatus";
import QuizBrowser, { type QuizStatus } from "@/components/public/quiz/QuizBrowser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UPSC Prelims-style Quizzes & MCQ Practice Tests | Naman IAS Academy",
  description:
    "Free daily UPSC Prelims-style MCQ practice tests for IAS/CSE aspirants — Polity, History, Geography, Economy, Environment, Current Affairs and CSAT. Instant results, explanations and analysis.",
  alternates: { canonical: `${SITE_URL}/quizzes` },
  openGraph: {
    title: "UPSC Prelims-style Quizzes & MCQ Practice Tests",
    description: "Practice daily UPSC CSE-pattern MCQs with instant server-scored results and explanations.",
    url: `${SITE_URL}/quizzes`,
    type: "website",
  },
};

export default async function QuizzesLanding() {
  const [quizzes, settings, courses, learner] = await Promise.all([
    getPublicQuizzes(),
    getSiteSettings(),
    getAllCourses(),
    resolveLearner(),
  ]);
  const quote = settings.content.quiz_quote || DEFAULT_CONTENT.quiz_quote!;
  const quoteAuthor = settings.content.quiz_quote_author || DEFAULT_CONTENT.quiz_quote_author!;

  // Per-quiz unlocked/locked state from the SAME central entitlement check.
  const statuses: Record<string, QuizStatus> = {};
  for (const quiz of quizzes) {
    const gate = gateQuiz(quiz, learner, courses);
    if (!gate.free) statuses[quiz.id] = gate.allowed ? "entitled" : "locked";
  }
  // Per-quiz attempt status (✓ Attempted + score + report/PDF) for logged-in learners.
  const attempts = await getAttemptStatusForLearner(learner);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "UPSC Prelims-style Quizzes",
    description: "Daily UPSC Pattern MCQ Practice tests by Naman IAS Academy.",
    url: `${SITE_URL}/quizzes`,
  };

  return (
    <div className="container-wide py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="mb-10 rounded-3xl bg-gradient-to-br from-primary/10 via-surface to-white p-8 text-center sm:p-12">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-primary">Daily UPSC Prelims-style MCQ Practice</p>
        <h1 className="font-heading text-3xl font-extrabold sm:text-4xl">Sharpen your Prelims with UPSC Pattern MCQs</h1>
        <p className="mx-auto mt-3 max-w-2xl text-ink2">
          Free, exam-realistic practice tests for IAS / CSE aspirants — with negative marking, a server-based timer,
          instant results, detailed explanations and topic-wise analysis.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {quizzes[0] && <Link href={`/quizzes/${quizzes[0].slug}`} className="btn btn-primary">Start Today&apos;s Quiz</Link>}
          <Link href="/courses" className="btn btn-secondary">Join Paid Portal</Link>
        </div>
      </section>

      <QuizBrowser quizzes={quizzes} statuses={statuses} attempts={attempts} />

      <figure className="relative mx-auto mt-14 max-w-3xl overflow-hidden rounded-3xl border border-[rgba(212,175,55,0.25)] bg-gradient-to-br from-[var(--ca-navy-900,#0a1a3f)] to-[var(--ca-navy-600,#1e3a8a)] px-6 py-10 text-center shadow-soft-lg sm:px-12 sm:py-14">
        <span className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-[rgba(212,175,55,0.18)] blur-2xl" aria-hidden="true" />
        <Quote size={36} className="mx-auto text-[var(--ca-gold-bright,#e9c75a)]" aria-hidden="true" />
        <blockquote className="mt-4">
          <p className="font-heading text-xl font-semibold leading-relaxed text-white sm:text-2xl">&ldquo;{quote}&rdquo;</p>
        </blockquote>
        <div className="mx-auto mt-6 h-px w-16 bg-[rgba(212,175,55,0.5)]" aria-hidden="true" />
        <figcaption className="mt-4 text-sm font-semibold uppercase tracking-wider text-[var(--ca-gold-bright,#e9c75a)]">{quoteAuthor}</figcaption>
      </figure>
    </div>
  );
}
