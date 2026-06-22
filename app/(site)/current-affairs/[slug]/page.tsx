import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PenLine, CalendarDays, Clock, Eye, Zap, Target, Download, FileText, Sparkles, ChevronRight, ArrowRight, ArrowLeft, ListChecks } from "lucide-react";
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
        <div className="bg-gradient-to-r from-[var(--ca-gold)] to-[var(--ca-gold-bright)] py-2 text-center text-sm font-semibold text-[var(--ca-navy-900)]">
          Preview mode — this article is <b>{article.status}</b> and not publicly visible.
        </div>
      )}

      <div className="container-wide py-8">
        {/* Breadcrumbs */}
        <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ca-slate-400)]">
          <Link href="/" className="transition hover:text-[var(--ca-navy-600)]">Home</Link><ChevronRight size={13} />
          <Link href="/current-affairs" className="transition hover:text-[var(--ca-navy-600)]">Current Affairs</Link>
          {article.category_slug && (<><ChevronRight size={13} /><Link href={`/current-affairs/category/${article.category_slug}`} className="transition hover:text-[var(--ca-navy-600)]">{caCategoryName(article.category_slug)}</Link></>)}
        </nav>

        <div className="grid gap-10 lg:grid-cols-[1fr_280px]">
          <article className="min-w-0">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-[rgba(30,58,138,0.16)] bg-[rgba(30,58,138,0.08)] px-3 py-1 text-xs font-bold text-[var(--ca-navy-600)]">{caArticleTypeLabel(article.article_type)}</span>
              {(upsc.gs_papers || []).map((p) => <span key={p} className="inline-flex items-center rounded-full border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] px-3 py-1 text-xs font-bold text-[var(--ca-slate-700)]">{p}</span>)}
              {upsc.difficulty && <span className="inline-flex items-center rounded-full border border-[rgba(212,175,55,0.35)] bg-[var(--ca-gold-soft)] px-3 py-1 text-xs font-bold capitalize text-[#8a6d12]">{upsc.difficulty}</span>}
            </div>
            <h1 className="mt-4 font-heading text-3xl font-extrabold leading-[1.12] tracking-tight text-[var(--ca-navy-900)] sm:text-[2.6rem]">{article.title}</h1>
            <p className="mt-4 text-lg leading-relaxed text-[var(--ca-slate-700)]">{article.summary}</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-[var(--ca-slate-400)]">
              {article.author && <span className="inline-flex items-center gap-1.5"><PenLine size={14} /> {article.author}</span>}
              <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} /> {caDateLabel(article.ca_date || article.publish_at)}</span>
              {article.reading_time ? <span className="inline-flex items-center gap-1.5"><Clock size={14} /> {article.reading_time} min read</span> : null}
              <span className="inline-flex items-center gap-1.5"><Eye size={14} /> {article.views.toLocaleString("en-IN")} views</span>
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
              <div className="mt-7 overflow-hidden rounded-2xl border border-[rgba(212,175,55,0.4)] bg-gradient-to-br from-[var(--ca-gold-soft)] to-[#fff8e6] p-5 shadow-[0_14px_32px_-18px_rgba(212,175,55,0.6)]">
                <h2 className="flex items-center gap-2 font-heading text-lg font-bold text-[var(--ca-navy-900)]">
                  <span className="ca-icon-chip" style={{ width: 34, height: 34 }}><Zap size={17} strokeWidth={2} /></span>
                  Quick Revision
                </h2>
                {qr.why_in_news && <p className="mt-3 text-sm text-[var(--ca-slate-800)]"><b className="text-[var(--ca-navy-900)]">Why in news:</b> {qr.why_in_news}</p>}
                {qr.bullets && qr.bullets.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--ca-slate-800)] marker:text-[var(--ca-gold)]">{qr.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
                )}
                {qr.exam_angle && <p className="mt-2 text-sm text-[var(--ca-slate-800)]"><b className="text-[var(--ca-navy-900)]">Exam angle:</b> {qr.exam_angle}</p>}
              </div>
            )}

            {/* Body */}
            {article.body_html && (
              <div id={BODY_ID} className="rich mt-8" dangerouslySetInnerHTML={{ __html: article.body_html }} />
            )}

            {/* Flexible sections */}
            {sections.map((s) => (
              <section key={s.id} className="mt-10">
                <h2 className="font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)]">{s.title}</h2>
                {s.subtitle && <p className="mt-1 text-[var(--ca-slate-700)]">{s.subtitle}</p>}
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
                <div className="rounded-2xl border border-[var(--ca-slate-200)] bg-white p-5 shadow-[0_12px_28px_-18px_rgba(10,26,63,0.25)]">
                  <h3 className="flex items-center gap-2 font-heading font-bold text-[var(--ca-navy-900)]"><Target size={18} className="text-[var(--ca-gold)]" /> Prelims angle</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--ca-slate-700)]">{qr.upsc_relevance || "Focus on key facts, terms and institutions mentioned above."}</p>
                </div>
                <div className="rounded-2xl border border-[var(--ca-slate-200)] bg-white p-5 shadow-[0_12px_28px_-18px_rgba(10,26,63,0.25)]">
                  <h3 className="flex items-center gap-2 font-heading font-bold text-[var(--ca-navy-900)]"><PenLine size={18} className="text-[var(--ca-gold)]" /> Mains angle</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--ca-slate-700)]">{qr.exam_angle || "Link to relevant GS themes and frame analytical points."}</p>
                  {upsc.syllabus_tags && upsc.syllabus_tags.length > 0 && (
                    <p className="mt-2 text-xs text-[var(--ca-slate-400)]">Syllabus: {upsc.syllabus_tags.join(", ")}</p>
                  )}
                </div>
              </div>
            )}

            {/* Tags */}
            {article.tags.length > 0 && (
              <div className="mt-8 flex flex-wrap gap-2">
                {article.tags.map((t) => (
                  <Link key={t} href={`/current-affairs/tag/${t}`} className="ca-focus inline-flex items-center rounded-full border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] px-3 py-1 text-xs font-semibold text-[var(--ca-slate-700)] transition hover:border-[rgba(212,175,55,0.6)] hover:text-[var(--ca-navy-900)]">#{t}</Link>
                ))}
              </div>
            )}

            {/* Source */}
            {(upsc.source_type || upsc.source_note) && (
              <p className="mt-6 text-xs text-[var(--ca-slate-400)]">Source: {[upsc.source_type, upsc.source_note].filter(Boolean).join(" — ")}</p>
            )}

            {/* PDFs */}
            {pdfs.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-3 flex items-center gap-2 font-heading text-xl font-bold text-[var(--ca-navy-900)]"><Download size={20} className="text-[var(--ca-gold)]" /> Download notes</h2>
                <div className="space-y-3">{pdfs.map((p) => <CaPdfButton key={p.id} pdf={p} />)}</div>
              </section>
            )}

            {/* Related quiz */}
            {quiz && (
              <section className="mt-10">
                <div className="ca-dark ca-grain relative overflow-hidden rounded-2xl p-6">
                  <div className="ca-orb" style={{ width: 200, height: 200, top: -100, right: -40, background: "rgba(212,175,55,0.18)" }} />
                  <p className="ca-eyebrow flex items-center gap-1.5"><ListChecks size={14} /> Test yourself</p>
                  <h2 className="mt-2 font-heading text-xl font-bold text-white">{quiz.title}</h2>
                  <p className="mt-1 text-sm text-[var(--ca-slate-300)]">{quizQuestions.length} questions · Practice the related MCQs now.</p>
                  <Link href={`/quizzes/${quiz.slug}`} className="ca-btn ca-btn-gold ca-focus mt-4">Attempt the quiz <ArrowRight size={16} /></Link>
                </div>
              </section>
            )}

            {/* Cross-sell */}
            {cs?.enabled && (cs.title || cs.href) && (
              <section className="mt-10">
                <div className="overflow-hidden rounded-2xl border border-[rgba(212,175,55,0.4)] bg-gradient-to-br from-[var(--ca-gold-soft)] to-[#fff8e6] p-6">
                  <h2 className="flex items-center gap-2 font-heading text-xl font-bold text-[var(--ca-navy-900)]"><Sparkles size={18} className="text-[var(--ca-gold)]" /> {cs.title || "Take your prep further"}</h2>
                  {cs.description && <p className="mt-1 text-sm text-[var(--ca-slate-700)]">{cs.description}</p>}
                  {cs.promo_code && <p className="mt-2 text-sm text-[var(--ca-slate-800)]">Use code <b className="font-mono text-[var(--ca-navy-900)]">{cs.promo_code}</b></p>}
                  {cs.href && <Link href={cs.href} className="ca-btn ca-btn-gold ca-focus mt-4">{cs.cta_label || "Explore"} <ArrowRight size={16} /></Link>}
                </div>
              </section>
            )}

            {/* Author bio */}
            {article.author && (
              <div className="mt-10 flex items-center gap-3 rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)] font-heading text-lg font-bold text-white">{article.author.charAt(0)}</div>
                <div>
                  <p className="font-semibold text-[var(--ca-navy-900)]">{article.author}</p>
                  <p className="text-xs text-[var(--ca-slate-400)]">{ACADEMY.name}</p>
                </div>
              </div>
            )}

            {/* Prev / Next */}
            <div className="mt-10 grid gap-3 sm:grid-cols-2">
              {older && <Link href={`/current-affairs/${older.slug}`} className="ca-card ca-focus group p-4"><span className="inline-flex items-center gap-1 text-xs text-[var(--ca-slate-400)]"><ArrowLeft size={13} /> Previous</span><p className="mt-1 font-medium leading-snug text-[var(--ca-navy-900)]">{older.title}</p></Link>}
              {newer && <Link href={`/current-affairs/${newer.slug}`} className="ca-card ca-focus group p-4 text-right sm:col-start-2"><span className="inline-flex items-center gap-1 text-xs text-[var(--ca-slate-400)]">Next <ArrowRight size={13} /></span><p className="mt-1 font-medium leading-snug text-[var(--ca-navy-900)]">{newer.title}</p></Link>}
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
                  <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--ca-slate-400)]">Related reads</p>
                  <div className="space-y-4">
                    {related.map((a) => (
                      <Link key={a.id} href={`/current-affairs/${a.slug}`} className="block text-sm font-medium leading-snug text-[var(--ca-slate-800)] transition hover:text-[var(--ca-navy-600)]">{a.title}</Link>
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
            <h2 className="mb-4 font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)]">More from Current Affairs</h2>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((a) => <CaArticleCard key={a.id} article={a} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
