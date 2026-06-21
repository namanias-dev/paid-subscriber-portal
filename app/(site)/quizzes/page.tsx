import type { Metadata } from "next";
import Link from "next/link";
import { getPublicQuizzes } from "@/lib/dataProvider";
import { SITE_URL } from "@/lib/config";
import QuizBrowser from "@/components/public/quiz/QuizBrowser";

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
  const quizzes = await getPublicQuizzes();

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

      <QuizBrowser quizzes={quizzes} />

      <p className="mt-10 text-center text-xs text-muted">
        UPSC Prelims-style practice tests by Naman IAS Academy. Not an official UPSC document.
      </p>
    </div>
  );
}
