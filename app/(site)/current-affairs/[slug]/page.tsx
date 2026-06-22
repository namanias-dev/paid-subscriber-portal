import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import CaReadingProgress from "@/components/public/ca/CaReadingProgress";
import CaToc from "@/components/public/ca/CaToc";
import CaShareBar from "@/components/public/ca/CaShareBar";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaLeadForm from "@/components/public/ca/CaLeadForm";
import {
  getCaArticleBySlug,
  getPublicCaArticles,
  isCaPublished,
  getCaPdfById,
  getQuizBySlug,
  getQuizQuestions,
  incrementCaView,
} from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { caCategoryName, caArticleTypeLabel } from "@/lib/caConstants";
import { caMetadata, caDateLabel } from "@/lib/caView";
import { SITE_URL, ACADEMY } from "@/lib/config";
import type { CaArticle, CaPdf } from "@/lib/types";

export const dynamic = "force-dynamic";

const BODY_ID = "ca-article-body";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | undefined>;
}): Promise<Metadata> {
  const a = await getCaArticleBySlug(params.slug);
  if (!a) return { title: "Article not found" };
  const preview = searchParams.preview === "1";
  const indexable = isCaPublished(a) && !preview;
  return caMetadata({
    title: a.title,
    description: a.summary,
    path: `/current-affairs/${a.seo?.canonical_slug?.trim() || a.slug}`,
    seo: a.seo,
    image: a.featured_image || a.thumbnail_image,
    indexable,
  });
}

export default async function CaArticlePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | undefined>;
}) {
  const article = await getCaArticleBySlug(params.slug);
  if (!article) notFound();

  const preview = searchParams.preview === "1";
  const published = isCaPublished(article);
  if (!published) {
    const admin = await getAdminSession();
    if (!(preview && admin)) notFound();
  }

  // Count a view (best-effort; only for live published reads).
  if (published && !preview) void incrementCaView(article.id);

  const all = await getPublicCaArticles();
  const others = all.filter((a) => a.id !== article.id);

  // Related: same category first, then shared tags.
  const related = others
    .filter((a) => a.category_slug === article.category_slug || a.tags.some((t) => article.tags.includes(t)))
    .slice(0, 3);

  // Prev/next by effective date order (all newest-first).
  const idx = all.findIndex((a) => a.id === article.id);
  const newer = idx > 0 ? all[idx - 1] : null;
  const older = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;

  // PDFs attached.
  const pdfs = (await Promise.all((article.pdf_ids || []).map((id) => getCaPdfById(id)))).filter(Boolean) as CaPdf[];

  // Related quiz.
  const quiz = article.related_quiz_slug ? await getQuizBySlug(article.related_quiz_slug) : null;
  const quizQuestions = quiz ? await getQuizQuestions(quiz.id) : [];

  const qr = article.quick_revision || {};
  const upsc = article.upsc || {};
  const sections = (article.sections || []).filter((s) => s.visible !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const cs = article.cross_sell;

  const articlePath = `/current-affairs/${article.slug}`;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.title,
    description: article.summary,
    datePublished: article.publish_at || article.created_at,
    dateModified: article.updated_at,
    image: article.featured_image ? [article.featured_image] : undefined,
    author: { "@type": article.author ? "Person" : "Organization", name: article.author || ACADEMY.name },
    publisher: { "@type": "Organization", name: ACADEMY.name, url: SITE_URL },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}${articlePath}` },
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Current Affairs", item: `${SITE_URL}/current-affairs` },
      ...(article.category_slug ? [{ "@type": "ListItem", position: 3, name: caCategoryName(article.category_slug), item: `${SITE_URL}/current-affairs/category/${article.category_slug}` }] : []),
    ],
  };
  const faqJsonLd = article.seo?.faq_schema_enabled && (article.seo?.faq?.length || 0) > 0
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: article.seo!.faq!.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      }
    : null;
  const structuredOn = article.seo?.structured_data_enabled !== false;

  return (
    <div className="pb-24 lg:pb-12">
      {published && !preview && structuredOn && (
        <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
          {faqJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />}
        </>
      )}
      <CaReadingProgress targetId={BODY_ID} />

      {preview && !published && (
        <div className="bg-[var(--gold)] py-2 text-center text-sm font-semibold text-[var(--navy)]">
          Preview mode — this article is <b>{article.status}</b> and not publicly visible.
        </div>
      )}

      <div className="container-wide py-8">
        {/* Breadcrumbs */}
        <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Link href="/" className="hover:text-ink">Home</Link><span>/</span>
          <Link href="/current-affairs" className="hover:text-ink">Current Affairs</Link>
          {article.category_slug && (<><span>/</span><Link href={`/current-affairs/category/${article.category_slug}`} className="hover:text-ink">{caCategoryName(article.category_slug)}</Link></>)}
        </nav>

        <div className="grid gap-10 lg:grid-cols-[1fr_280px]">
          <article className="min-w-0">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill pill-blue">{caArticleTypeLabel(article.article_type)}</span>
              {(upsc.gs_papers || []).map((p) => <span key={p} className="pill pill-gray">{p}</span>)}
              {upsc.difficulty && <span className="pill pill-amber capitalize">{upsc.difficulty}</span>}
              {article.important && <span className="pill pill-red">Important</span>}
            </div>
            <h1 className="mt-4 font-heading text-3xl font-extrabold leading-tight sm:text-4xl">{article.title}</h1>
            <p className="mt-3 text-lg text-ink2">{article.summary}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              {article.author && <span>✍️ {article.author}</span>}
              <span>📅 {caDateLabel(article.ca_date || article.publish_at)}</span>
              {article.reading_time ? <span>⏱ {article.reading_time} min read</span> : null}
              <span>👁 {article.views.toLocaleString("en-IN")} views</span>
            </div>

            <div className="mt-4"><CaShareBar slug={article.slug} title={article.title} path={articlePath} /></div>

            {article.featured_image && (
              <div className="mt-6 overflow-hidden rounded-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={article.featured_image} alt={article.title} className="w-full object-cover" />
              </div>
            )}

            {/* Mobile TOC */}
            <div className="mt-6 lg:hidden"><CaToc targetId={BODY_ID} /></div>

            {/* Quick Revision */}
            {(qr.bullets?.length || qr.why_in_news || qr.exam_angle) && (
              <div className="mt-6 rounded-2xl border border-[var(--gold)] bg-[var(--gold-soft)] p-5">
                <h2 className="font-heading text-lg font-bold text-[var(--navy)]">⚡ Quick Revision</h2>
                {qr.why_in_news && <p className="mt-2 text-sm"><b>Why in news:</b> {qr.why_in_news}</p>}
                {qr.bullets && qr.bullets.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{qr.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
                )}
                {qr.exam_angle && <p className="mt-2 text-sm"><b>Exam angle:</b> {qr.exam_angle}</p>}
              </div>
            )}

            {/* Body */}
            {article.body_html && (
              <div id={BODY_ID} className="rich mt-8" dangerouslySetInnerHTML={{ __html: article.body_html }} />
            )}

            {/* Flexible sections */}
            {sections.map((s) => (
              <section key={s.id} className="mt-10">
                <h2 className="font-heading text-2xl font-bold">{s.title}</h2>
                {s.subtitle && <p className="mt-1 text-ink2">{s.subtitle}</p>}
                {s.image_url && (
                  <div className="mt-3 overflow-hidden rounded-xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.image_url} alt={s.title} className="w-full object-cover" loading="lazy" />
                  </div>
                )}
                {s.content && <div className="rich mt-3" dangerouslySetInnerHTML={{ __html: s.content }} />}
              </section>
            ))}

            {/* Prelims / Mains boxes */}
            {(qr.upsc_relevance || upsc.exam_relevance || upsc.syllabus_tags?.length) && (
              <div className="mt-10 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-line bg-surface p-5">
                  <h3 className="font-heading font-bold text-[var(--navy)]">🎯 Prelims angle</h3>
                  <p className="mt-2 text-sm text-ink2">{qr.upsc_relevance || "Focus on key facts, terms and institutions mentioned above."}</p>
                </div>
                <div className="rounded-2xl border border-line bg-surface p-5">
                  <h3 className="font-heading font-bold text-[var(--navy)]">📝 Mains angle</h3>
                  <p className="mt-2 text-sm text-ink2">{qr.exam_angle || "Link to relevant GS themes and frame analytical points."}</p>
                  {upsc.syllabus_tags && upsc.syllabus_tags.length > 0 && (
                    <p className="mt-2 text-xs text-muted">Syllabus: {upsc.syllabus_tags.join(", ")}</p>
                  )}
                </div>
              </div>
            )}

            {/* Tags */}
            {article.tags.length > 0 && (
              <div className="mt-8 flex flex-wrap gap-2">
                {article.tags.map((t) => (
                  <Link key={t} href={`/current-affairs/tag/${t}`} className="pill pill-gray text-xs hover:opacity-80">#{t}</Link>
                ))}
              </div>
            )}

            {/* Source */}
            {(upsc.source_type || upsc.source_note) && (
              <p className="mt-6 text-xs text-muted">Source: {[upsc.source_type, upsc.source_note].filter(Boolean).join(" — ")}</p>
            )}

            {/* PDFs */}
            {pdfs.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-3 font-heading text-xl font-bold">📥 Download notes</h2>
                <div className="space-y-3">{pdfs.map((p) => <CaPdfButton key={p.id} pdf={p} />)}</div>
              </section>
            )}

            {/* Related quiz */}
            {quiz && (
              <section className="mt-10">
                <div className="rounded-2xl border border-line bg-gradient-to-br from-[var(--navy)] to-[#13306e] p-6 text-white">
                  <p className="text-sm font-semibold uppercase tracking-wide text-[var(--gold)]">Test yourself</p>
                  <h2 className="mt-1 font-heading text-xl font-bold">{quiz.title}</h2>
                  <p className="mt-1 text-sm text-white/80">{quizQuestions.length} questions · Practice the related MCQs now.</p>
                  <Link href={`/quizzes/${quiz.slug}`} className="btn btn-primary mt-4">Attempt the quiz →</Link>
                </div>
              </section>
            )}

            {/* Cross-sell */}
            {cs?.enabled && (cs.title || cs.href) && (
              <section className="mt-10">
                <div className="rounded-2xl border border-[var(--gold)] bg-[var(--gold-soft)] p-6">
                  <h2 className="font-heading text-xl font-bold text-[var(--navy)]">{cs.title || "Take your prep further"}</h2>
                  {cs.description && <p className="mt-1 text-sm text-ink2">{cs.description}</p>}
                  {cs.promo_code && <p className="mt-2 text-sm">Use code <b className="font-mono">{cs.promo_code}</b></p>}
                  {cs.href && <Link href={cs.href} className="btn btn-primary mt-4">{cs.cta_label || "Explore →"}</Link>}
                </div>
              </section>
            )}

            {/* Author bio */}
            {article.author && (
              <div className="mt-10 flex items-center gap-3 rounded-2xl border border-line bg-surface p-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--navy)] font-heading text-lg font-bold text-white">{article.author.charAt(0)}</div>
                <div>
                  <p className="font-semibold">{article.author}</p>
                  <p className="text-xs text-muted">{ACADEMY.name}</p>
                </div>
              </div>
            )}

            {/* Prev / Next */}
            <div className="mt-10 grid gap-3 sm:grid-cols-2">
              {older && <Link href={`/current-affairs/${older.slug}`} className="card p-4 transition hover:shadow-md"><span className="text-xs text-muted">← Previous</span><p className="mt-1 font-medium leading-snug">{older.title}</p></Link>}
              {newer && <Link href={`/current-affairs/${newer.slug}`} className="card p-4 text-right transition hover:shadow-md sm:col-start-2"><span className="text-xs text-muted">Next →</span><p className="mt-1 font-medium leading-snug">{newer.title}</p></Link>}
            </div>

            {/* Lead capture */}
            <section className="mt-12"><CaLeadForm source={`ca-article:${article.slug}`} /></section>
          </article>

          {/* Sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-8">
              <CaToc targetId={BODY_ID} />
              {related.length > 0 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Related reads</p>
                  <div className="space-y-4">
                    {related.map((a) => (
                      <Link key={a.id} href={`/current-affairs/${a.slug}`} className="block text-sm font-medium leading-snug hover:text-primary">{a.title}</Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* Related cards */}
        {related.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-4 font-heading text-2xl font-bold">More from Current Affairs</h2>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((a) => <CaArticleCard key={a.id} article={a} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
