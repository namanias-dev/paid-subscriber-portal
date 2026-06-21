import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuizBySlug, getQuizQuestions } from "@/lib/dataProvider";
import { SITE_URL } from "@/lib/config";
import { quizIsLive } from "@/lib/quizAccess";
import { sanitizeHtml } from "@/lib/sanitizeHtml";

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

  const quizQuestions = await getQuizQuestions(quiz.id);
  const live = quizIsLive(quiz);
  const totalMarks = quizQuestions.reduce((sum, qq) => sum + (qq.marks ?? quiz.marks_per_question), 0);
  const seo = quiz.seo || {};

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

      <div className="sticky bottom-4 mt-6">
        {live ? (
          <Link href={`/quizzes/${quiz.slug}/attempt`} className="btn btn-primary w-full py-3 text-base shadow-lg">Start Test →</Link>
        ) : (
          <div className="btn btn-secondary w-full cursor-not-allowed py-3 text-base opacity-70">This test isn&apos;t available right now</div>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-muted">UPSC Prelims-style practice test by Naman IAS Academy. Not an official UPSC document.</p>
    </div>
  );
}
