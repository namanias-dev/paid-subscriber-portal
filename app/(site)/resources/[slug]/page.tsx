import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PenLine, CalendarDays, Clock, Eye, ChevronRight, ArrowRight, ArrowLeft, HelpCircle, Download, ListChecks, GraduationCap, Video } from "lucide-react";
import CaReadingProgress from "@/components/public/ca/CaReadingProgress";
import CaToc from "@/components/public/ca/CaToc";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
import ResourceShareBar from "@/components/public/resources/ResourceShareBar";
import ResourceCtas from "@/components/public/resources/ResourceCtas";
import ResourceCard from "@/components/public/resources/ResourceCard";
import {
  getResourceBySlug,
  getPublicResources,
  isResourcePublished,
  incrementResourceView,
  getCaPdfById,
  getAllQuizzes,
  getPublicWebinars,
  getAllCourses,
} from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { resourceMetadata, computeRelatedResources, journeyResources } from "@/lib/resourceView";
import { resourceCategoryName, resourceCategoryMeta, RESERVED_RESOURCE_SLUGS } from "@/lib/resourceConstants";
import { formatISTDate } from "@/lib/dates";
import { SITE_URL, ACADEMY } from "@/lib/config";
import type { CaPdf } from "@/lib/types";

export const dynamic = "force-dynamic";
const BODY_ID = "resource-article-body";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | undefined>;
}): Promise<Metadata> {
  // Category cluster page.
  if (RESERVED_RESOURCE_SLUGS.has(params.slug)) {
    const cat = resourceCategoryMeta(params.slug);
    if (!cat) return { title: "Resources" };
    return resourceMetadata({
      title: `${cat.name} — UPSC Resources | ${ACADEMY.shortName}`,
      description: cat.blurb,
      path: `/resources/${cat.slug}`,
    });
  }
  const r = await getResourceBySlug(params.slug);
  if (!r) return { title: "Resource not found" };
  const preview = searchParams.preview === "1";
  return resourceMetadata({
    title: r.title,
    description: r.summary,
    path: `/resources/${r.slug}`,
    seo: r.seo,
    image: r.featured_image,
    indexable: isResourcePublished(r) && !preview,
  });
}

export default async function ResourceOrCategoryPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | undefined>;
}) {
  // ---- Category cluster page ----
  if (RESERVED_RESOURCE_SLUGS.has(params.slug)) {
    return <CategoryPage slug={params.slug} />;
  }
  // ---- Article page ----
  return <ArticlePage slug={params.slug} preview={searchParams.preview === "1"} />;
}

// ============================ CATEGORY CLUSTER ============================
async function CategoryPage({ slug }: { slug: string }) {
  const cat = resourceCategoryMeta(slug);
  if (!cat) notFound();
  const all = await getPublicResources();
  const items = all.filter((r) => r.category === slug);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Resources", item: `${SITE_URL}/resources` },
      { "@type": "ListItem", position: 3, name: cat.name, item: `${SITE_URL}/resources/${cat.slug}` },
    ],
  };

  return (
    <div className="pb-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <section className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 300, height: 300, top: -120, right: -60, background: "rgba(212,175,55,0.16)" }} />
        <div className="container-wide relative py-14">
          <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ca-slate-300)]">
            <Link href="/" className="hover:text-white">Home</Link><ChevronRight size={13} />
            <Link href="/resources" className="hover:text-white">Resources</Link><ChevronRight size={13} />
            <span className="text-white/90">{cat.name}</span>
          </nav>
          <p className="ca-eyebrow">{cat.icon} UPSC Resources</p>
          <h1 className="mt-2 font-heading text-4xl font-extrabold tracking-tight text-white">{cat.name}</h1>
          <p className="mt-3 max-w-2xl text-[var(--ca-slate-300)]">{cat.blurb}</p>
        </div>
      </section>

      <div className="container-wide py-12">
        {items.length === 0 ? (
          <p className="py-16 text-center text-[var(--ca-slate-400)]">Guides for this topic are coming soon.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((r) => <ResourceCard key={r.id} resource={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================ ARTICLE ============================
async function ArticlePage({ slug, preview }: { slug: string; preview: boolean }) {
  const article = await getResourceBySlug(slug);
  if (!article) notFound();

  const published = isResourcePublished(article);
  if (!published) {
    const admin = await getAdminSession();
    if (!(preview && admin)) notFound();
  }
  if (published && !preview) void incrementResourceView(article.id);

  const all = await getPublicResources();

  // Related resources (admin picks + overlap).
  const related = computeRelatedResources(article, all, 4);

  // Prev/next: within the journey if this article is part of it, else global order.
  const journey = journeyResources(all);
  const seq = (article.journey_stage || "").trim() ? journey : all;
  const idx = seq.findIndex((r) => r.id === article.id);
  const prev = idx > 0 ? seq[idx - 1] : null;
  const next = idx >= 0 && idx < seq.length - 1 ? seq[idx + 1] : null;

  // Attached PDFs (reuse CA PDF library).
  const pdfs = (await Promise.all((article.pdf_ids || []).map((id) => getCaPdfById(id)))).filter(Boolean) as CaPdf[];

  // Related quizzes/webinars/courses by slug.
  const [quizzes, webinars, courses] = await Promise.all([getAllQuizzes(), getPublicWebinars(), getAllCourses()]);
  const relQuizzes = (article.related?.quiz_slugs || []).map((s) => quizzes.find((q) => q.slug === s)).filter(Boolean);
  const relWebinars = (article.related?.webinar_slugs || []).map((s) => webinars.find((w) => w.slug === s)).filter(Boolean);
  const relCourses = (article.related?.course_slugs || []).map((s) => courses.find((c) => c.slug === s)).filter(Boolean);

  const sections = (article.sections || []).filter((s) => s.visible !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const articlePath = `/resources/${article.slug}`;
  const structuredOn = article.seo?.structured_data_enabled !== false;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
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
      { "@type": "ListItem", position: 2, name: "Resources", item: `${SITE_URL}/resources` },
      ...(article.category ? [{ "@type": "ListItem", position: 3, name: resourceCategoryName(article.category), item: `${SITE_URL}/resources/${article.category}` }] : []),
    ],
  };
  const faqJsonLd = article.seo?.faq_schema_enabled !== false && (article.faq?.length || 0) > 0
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: article.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      }
    : null;
  const localJsonLd = article.is_local
    ? {
        "@context": "https://schema.org",
        "@type": "EducationalOrganization",
        name: ACADEMY.name,
        url: SITE_URL,
        address: { "@type": "PostalAddress", streetAddress: ACADEMY.address, addressLocality: "Chandigarh", addressRegion: "Chandigarh", addressCountry: "IN" },
        areaServed: ACADEMY.citiesServed,
        sameAs: [ACADEMY.instagram, ACADEMY.youtube].filter(Boolean),
      }
    : null;

  return (
    <div className="pb-24 lg:pb-12">
      {published && !preview && structuredOn && (
        <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
          {faqJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />}
          {localJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(localJsonLd) }} />}
        </>
      )}
      <CaReadingProgress targetId={BODY_ID} />

      {preview && !published && (
        <div className="bg-gradient-to-r from-[var(--ca-gold)] to-[var(--ca-gold-bright)] py-2 text-center text-sm font-semibold text-[var(--ca-navy-900)]">
          Preview mode — this resource is <b>{article.status}</b> and not publicly visible.
        </div>
      )}

      <div className="container-wide py-8">
        {/* Breadcrumbs */}
        <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ca-slate-400)]">
          <Link href="/" className="transition hover:text-[var(--ca-navy-600)]">Home</Link><ChevronRight size={13} />
          <Link href="/resources" className="transition hover:text-[var(--ca-navy-600)]">Resources</Link>
          {article.category && (<><ChevronRight size={13} /><Link href={`/resources/${article.category}`} className="transition hover:text-[var(--ca-navy-600)]">{resourceCategoryName(article.category)}</Link></>)}
        </nav>

        <div className="grid gap-10 lg:grid-cols-[1fr_280px]">
          <article className="min-w-0">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-2">
              {article.category && <span className="inline-flex items-center rounded-full border border-[rgba(30,58,138,0.16)] bg-[rgba(30,58,138,0.08)] px-3 py-1 text-xs font-bold text-[var(--ca-navy-600)]">{resourceCategoryName(article.category)}</span>}
              {article.difficulty && <span className="inline-flex items-center rounded-full border border-[rgba(212,175,55,0.35)] bg-[var(--ca-gold-soft)] px-3 py-1 text-xs font-bold capitalize text-[#8a6d12]">{article.difficulty}</span>}
              {article.journey_stage && <span className="inline-flex items-center rounded-full border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] px-3 py-1 text-xs font-bold text-[var(--ca-slate-700)]">{article.journey_stage}</span>}
            </div>
            <h1 className="mt-4 font-heading text-3xl font-extrabold leading-[1.12] tracking-tight text-[var(--ca-navy-900)] sm:text-[2.6rem]">{article.title}</h1>
            {article.summary && <p className="mt-4 text-lg leading-relaxed text-[var(--ca-slate-700)]">{article.summary}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-[var(--ca-slate-400)]">
              {article.author && <span className="inline-flex items-center gap-1.5"><PenLine size={14} /> {article.author}</span>}
              <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} /> Updated {formatISTDate(article.updated_at)}</span>
              {article.reading_time ? <span className="inline-flex items-center gap-1.5"><Clock size={14} /> {article.reading_time} min read</span> : null}
              <span className="inline-flex items-center gap-1.5"><Eye size={14} /> {article.views.toLocaleString("en-IN")} views</span>
            </div>

            <div className="mt-4"><ResourceShareBar title={article.title} path={articlePath} /></div>

            {article.featured_image && (
              <div className="mt-6 overflow-hidden rounded-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={article.featured_image} alt={article.title} className="w-full object-cover" />
              </div>
            )}

            {/* Mobile TOC */}
            <div className="mt-6 lg:hidden"><CaToc targetId={BODY_ID} /></div>

            {/* Body */}
            {article.body_html && <div id={BODY_ID} className="rich mt-8" dangerouslySetInnerHTML={{ __html: article.body_html }} />}

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

            {/* FAQ */}
            {article.faq && article.faq.length > 0 && (
              <section className="mt-12">
                <h2 className="flex items-center gap-2 font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)]"><HelpCircle size={22} className="text-[var(--ca-gold)]" /> Frequently asked questions</h2>
                <div className="mt-4 divide-y divide-[var(--ca-slate-200)] rounded-2xl border border-[var(--ca-slate-200)] bg-white">
                  {article.faq.map((f, i) => (
                    <details key={i} className="group p-5">
                      <summary className="ca-focus flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-[var(--ca-navy-900)]">
                        {f.q}
                        <ChevronRight size={18} className="shrink-0 text-[var(--ca-slate-400)] transition group-open:rotate-90" />
                      </summary>
                      <p className="mt-3 text-sm leading-relaxed text-[var(--ca-slate-700)]">{f.a}</p>
                    </details>
                  ))}
                </div>
              </section>
            )}

            {/* PDFs */}
            {pdfs.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-3 flex items-center gap-2 font-heading text-xl font-bold text-[var(--ca-navy-900)]"><Download size={20} className="text-[var(--ca-gold)]" /> Free downloads</h2>
                <div className="space-y-3">{pdfs.map((p) => <CaPdfButton key={p.id} pdf={p} />)}</div>
              </section>
            )}

            {/* Tags */}
            {article.tags.length > 0 && (
              <div className="mt-8 flex flex-wrap gap-2">
                {article.tags.map((t) => (
                  <span key={t} className="inline-flex items-center rounded-full border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] px-3 py-1 text-xs font-semibold text-[var(--ca-slate-700)]">#{t}</span>
                ))}
              </div>
            )}

            {/* CTA blocks */}
            <ResourceCtas blocks={article.cta_blocks || []} />

            {/* Related quizzes / webinars / courses */}
            {(relQuizzes.length > 0 || relWebinars.length > 0 || relCourses.length > 0) && (
              <section className="mt-10 grid gap-3 sm:grid-cols-2">
                {relQuizzes.map((q) => q && (
                  <Link key={q.slug} href={`/quizzes/${q.slug}`} className="ca-card ca-focus flex items-center gap-3 p-4"><ListChecks size={18} className="text-[var(--ca-gold)]" /><span className="text-sm font-medium text-[var(--ca-navy-900)]">{q.title}</span></Link>
                ))}
                {relWebinars.map((w) => w && (
                  <Link key={w.slug} href={`/webinars/${w.slug}`} className="ca-card ca-focus flex items-center gap-3 p-4"><Video size={18} className="text-[var(--ca-gold)]" /><span className="text-sm font-medium text-[var(--ca-navy-900)]">{w.title}</span></Link>
                ))}
                {relCourses.map((c) => c && (
                  <Link key={c.slug} href={`/courses/${c.slug}`} className="ca-card ca-focus flex items-center gap-3 p-4"><GraduationCap size={18} className="text-[var(--ca-gold)]" /><span className="text-sm font-medium text-[var(--ca-navy-900)]">{c.title}</span></Link>
                ))}
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

            {/* Prev / Next (journey-aware) */}
            {(prev || next) && (
              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                {prev && <Link href={`/resources/${prev.slug}`} className="ca-card ca-focus group p-4"><span className="inline-flex items-center gap-1 text-xs text-[var(--ca-slate-400)]"><ArrowLeft size={13} /> Previous</span><p className="mt-1 font-medium leading-snug text-[var(--ca-navy-900)]">{prev.title}</p></Link>}
                {next && <Link href={`/resources/${next.slug}`} className="ca-card ca-focus group p-4 text-right sm:col-start-2"><span className="inline-flex items-center gap-1 text-xs text-[var(--ca-slate-400)]">Next <ArrowRight size={13} /></span><p className="mt-1 font-medium leading-snug text-[var(--ca-navy-900)]">{next.title}</p></Link>}
              </div>
            )}
          </article>

          {/* Sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-8">
              <CaToc targetId={BODY_ID} />
              {related.length > 0 && (
                <div>
                  <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--ca-slate-400)]">Related reads</p>
                  <div className="space-y-4">
                    {related.map((r) => (
                      <Link key={r.id} href={`/resources/${r.slug}`} className="block text-sm font-medium leading-snug text-[var(--ca-slate-800)] transition hover:text-[var(--ca-navy-600)]">{r.title}</Link>
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
            <h2 className="mb-4 font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)]">More UPSC guides</h2>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => <ResourceCard key={r.id} resource={r} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
