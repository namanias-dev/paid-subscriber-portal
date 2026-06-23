import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Archive, FileText, Compass, ArrowRight, TrendingUp, Download, Search, BookOpen } from "lucide-react";
import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaFilterChips from "@/components/public/ca/CaFilterChips";
import CaLeadForm from "@/components/public/ca/CaLeadForm";
import CaStickyCTA from "@/components/public/ca/CaStickyCTA";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
import { CaIconChip, categoryIcon } from "@/components/public/ca/CaIcons";
import { getPublicCaArticles, getCaPdfs } from "@/lib/dataProvider";
import { DEFAULT_CA_CATEGORIES } from "@/lib/caConstants";
import { caMetadata, caDateLabel, caMonthLabel, groupByDate } from "@/lib/caView";
import { SITE_URL, ACADEMY } from "@/lib/config";
import type { CaArticle } from "@/lib/types";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return caMetadata({
    title: `UPSC Current Affairs — Daily, Monthly PDFs & Analysis | ${ACADEMY.shortName}`,
    description:
      "Daily UPSC current affairs, editorials, Prelims facts and Mains analysis with monthly PDF compilations, topic archives and quizzes for IAS/CSE aspirants.",
    path: "/current-affairs",
  });
}

const PER_PAGE = 12;

const QUICK_LINKS = [
  { href: "#today", icon: CalendarDays, label: "Today's CA", sub: "Fresh, exam-ready briefs" },
  { href: "/current-affairs/daily", icon: Archive, label: "Daily Current Affairs PDFs", sub: "PDFs + each day's articles" },
  { href: "/current-affairs/monthly", icon: FileText, label: "Monthly PDFs", sub: "Compiled & downloadable" },
  { href: "#categories", icon: Compass, label: "Browse Topics", sub: "14 GS-aligned subjects" },
];

function matchesFilters(a: CaArticle, type: string, gs: string, rel: string, q: string): boolean {
  if (type && a.article_type !== type) return false;
  if (gs && !(a.upsc?.gs_papers || []).includes(gs as never)) return false;
  if (rel) {
    const er = a.upsc?.exam_relevance;
    if (rel === "prelims" && !(er === "prelims" || er === "both" || (a.upsc?.gs_papers || []).includes("Prelims" as never))) return false;
    if (rel === "mains" && !(er === "mains" || er === "both")) return false;
  }
  if (q) {
    const t = q.toLowerCase();
    if (!`${a.title} ${a.summary} ${(a.tags || []).join(" ")}`.toLowerCase().includes(t)) return false;
  }
  return true;
}

export default async function CurrentAffairsHub({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const [articles, pdfs] = await Promise.all([getPublicCaArticles(), getCaPdfs()]);

  const type = searchParams.type || "";
  const gs = searchParams.gs || "";
  const rel = searchParams.rel || "";
  const q = (searchParams.q || "").trim();
  const sort = searchParams.sort || "newest";
  const page = Math.max(1, Number(searchParams.page) || 1);

  const filtered = articles.filter((a) => matchesFilters(a, type, gs, rel, q));
  const isFiltering = !!(type || gs || rel || q);

  const groups = groupByDate(articles);
  const todayGroup = groups[0];
  const monthlyPdfs = pdfs.filter((p) => p.kind === "monthly").slice(0, 4);
  const mostDownloaded = [...pdfs].filter((p) => p.download_count > 0).sort((a, b) => b.download_count - a.download_count).slice(0, 3);
  const trending = articles.filter((a) => a.trending).slice(0, 5);

  const sorted = sort === "most_read" ? [...filtered].sort((a, b) => b.views - a.views) : filtered;
  const pageItems = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Current Affairs", item: `${SITE_URL}/current-affairs` },
    ],
  };

  const buildHref = (overrides: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { type, gs, rel, q, sort, ...overrides };
    Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
    const s = params.toString();
    return `/current-affairs${s ? `?${s}` : ""}`;
  };

  return (
    <div className="pb-24 lg:pb-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      {/* Hero */}
      <section className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 360, height: 360, top: -140, right: -80, background: "rgba(212,175,55,0.16)" }} />
        <div className="ca-orb" style={{ width: 300, height: 300, bottom: -160, left: -100, background: "rgba(30,58,138,0.5)" }} />
        <div className="container-wide relative py-14 sm:py-20">
          <Reveal>
            <p className="ca-eyebrow">UPSC Current Affairs</p>
            <h1 className="mt-3 max-w-3xl font-heading text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              <span className="ca-hero-title">Daily current affairs, monthly PDFs & exam-ready analysis</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--ca-slate-300)] sm:text-lg">
              Curated for Prelims & Mains — concise, source-backed and updated every day. Read, revise and download.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="#today" className="ca-btn ca-btn-gold ca-focus">
                <BookOpen size={18} strokeWidth={2} /> Read today&apos;s CA
              </Link>
              <Link href="/current-affairs/monthly" className="ca-btn ca-btn-glass ca-focus">
                <FileText size={18} strokeWidth={2} /> Monthly PDFs
              </Link>
            </div>
          </Reveal>

          {/* Quick-link glass cards */}
          <Stagger className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {QUICK_LINKS.map((c) => (
              <StaggerItem key={c.label} className="h-full">
                <Link href={c.href} className="ca-glass ca-focus group flex h-full flex-col gap-3 p-5">
                  <CaIconChip icon={c.icon} />
                  <div>
                    <p className="font-heading text-base font-bold text-white">{c.label}</p>
                    <p className="mt-0.5 text-sm text-[var(--ca-slate-400)]">{c.sub}</p>
                  </div>
                  <ArrowRight size={18} className="mt-auto text-[var(--ca-gold-bright)] transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <div className="container-wide py-12">
        {/* Filters + search */}
        <div className="mb-10 space-y-4">
          <CaFilterChips />
          <form action="/current-affairs" className="flex gap-2">
            <div className="relative max-w-md flex-1">
              <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ca-slate-400)]" aria-hidden="true" />
              <input name="q" defaultValue={q} placeholder="Search current affairs…" className="input ca-focus pl-9" />
            </div>
            {type && <input type="hidden" name="type" value={type} />}
            <button className="ca-btn ca-btn-outline ca-focus">Search</button>
          </form>
        </div>

        {isFiltering ? (
          <section>
            <h2 className="mb-6 font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)]">{sorted.length} result{sorted.length === 1 ? "" : "s"}</h2>
            {pageItems.length === 0 ? (
              <p className="rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-10 text-center text-[var(--ca-slate-700)]">No articles match these filters. <Link href="/current-affairs" className="font-semibold text-[var(--ca-navy-600)] underline">Clear filters</Link></p>
            ) : (
              <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {pageItems.map((a) => <StaggerItem key={a.id} className="h-full"><CaArticleCard article={a} /></StaggerItem>)}
              </Stagger>
            )}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3 text-sm">
                {page > 1 && <Link href={buildHref({ page: page - 1 })} className="ca-btn ca-btn-outline ca-focus">← Prev</Link>}
                <span className="text-[var(--ca-slate-700)]">Page {page} of {totalPages}</span>
                {page < totalPages && <Link href={buildHref({ page: page + 1 })} className="ca-btn ca-btn-outline ca-focus">Next →</Link>}
              </div>
            )}
          </section>
        ) : (
          <>
            {/* Today's CA */}
            {todayGroup && (
              <section id="today" className="scroll-mt-24">
                <div className="mb-6 flex items-end justify-between gap-3">
                  <h2 className="font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)] sm:text-3xl">Today&apos;s Current Affairs</h2>
                  <span className="ca-badge ca-badge-gold border border-[rgba(212,175,55,0.3)]" style={{ color: "#8a6d12", background: "var(--ca-gold-soft)" }}>{caDateLabel(todayGroup.date)}</span>
                </div>
                <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {todayGroup.items.slice(0, 6).map((a) => <StaggerItem key={a.id} className="h-full"><CaArticleCard article={a} /></StaggerItem>)}
                </Stagger>
              </section>
            )}

            {/* Category grid */}
            <section id="categories" className="mt-16 scroll-mt-24">
              <h2 className="mb-6 font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)] sm:text-3xl">Browse by topic</h2>
              <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {DEFAULT_CA_CATEGORIES.map((c) => (
                  <StaggerItem key={c.slug} className="h-full">
                    <Link href={`/current-affairs/category/${c.slug}`} className="ca-card ca-focus group flex h-full items-center gap-3 p-4">
                      <CaIconChip icon={categoryIcon(c.slug)} variant="light" size={20} />
                      <span className="text-sm font-semibold leading-tight text-[var(--ca-navy-900)]">{c.name}</span>
                      <ArrowRight size={16} className="ml-auto text-[var(--ca-slate-400)] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--ca-gold)]" aria-hidden="true" />
                    </Link>
                  </StaggerItem>
                ))}
              </Stagger>
            </section>

            {/* Monthly PDFs */}
            {monthlyPdfs.length > 0 && (
              <section className="mt-16">
                <div className="mb-6 flex items-end justify-between">
                  <h2 className="font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)] sm:text-3xl">Monthly compilations</h2>
                  <Link href="/current-affairs/monthly" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ca-navy-600)]">View all <ArrowRight size={15} /></Link>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {monthlyPdfs.map((p) => (
                    <div key={p.id} className="ca-card flex flex-col p-5">
                      <CaIconChip icon={FileText} variant="light" />
                      <p className="mt-3 font-semibold leading-tight text-[var(--ca-navy-900)]">{p.title}</p>
                      <p className="text-xs text-[var(--ca-slate-400)]">{caMonthLabel(p.date_ref)}</p>
                      <div className="mt-3"><CaPdfButton pdf={p} /></div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Recent by date */}
            {groups.length > 1 && (
              <section className="mt-16">
                <h2 className="mb-6 font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)] sm:text-3xl">Recent days</h2>
                <div className="space-y-10">
                  {groups.slice(1, 4).map((g) => (
                    <div key={g.date}>
                      <h3 className="mb-3 text-sm font-semibold text-[var(--ca-slate-700)]">{caDateLabel(g.date)}</h3>
                      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                        {g.items.slice(0, 3).map((a) => <CaArticleCard key={a.id} article={a} compact />)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-8 text-center"><Link href="/current-affairs/daily" className="ca-btn ca-btn-outline ca-focus">See full daily archive →</Link></div>
              </section>
            )}

            {/* Trending + most downloaded */}
            {(trending.length > 0 || mostDownloaded.length > 0) && (
              <section className="mt-16 grid gap-6 lg:grid-cols-2">
                {trending.length > 0 && (
                  <div className="ca-card p-6">
                    <h2 className="mb-4 flex items-center gap-2 font-heading text-xl font-bold text-[var(--ca-navy-900)]"><TrendingUp size={20} className="text-[var(--ca-gold)]" /> Trending</h2>
                    <ol className="space-y-3.5">
                      {trending.map((a, i) => (
                        <li key={a.id} className="flex gap-3">
                          <span className="font-heading text-lg font-extrabold tabular-nums text-[var(--ca-gold)]">{String(i + 1).padStart(2, "0")}</span>
                          <Link href={`/current-affairs/${a.slug}`} className="text-sm font-medium text-[var(--ca-slate-800)] transition hover:text-[var(--ca-navy-600)]">{a.title}</Link>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {mostDownloaded.length > 0 && (
                  <div className="ca-card p-6">
                    <h2 className="mb-4 flex items-center gap-2 font-heading text-xl font-bold text-[var(--ca-navy-900)]"><Download size={20} className="text-[var(--ca-gold)]" /> Most downloaded</h2>
                    <div className="space-y-3">{mostDownloaded.map((p) => <CaPdfButton key={p.id} pdf={p} />)}</div>
                  </div>
                )}
              </section>
            )}

            {/* Lead capture */}
            <section className="mt-16"><CaLeadForm source="ca-hub" /></section>
          </>
        )}
      </div>

      <CaStickyCTA />
    </div>
  );
}
