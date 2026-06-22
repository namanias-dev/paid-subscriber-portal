import type { Metadata } from "next";
import Link from "next/link";
import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaFilterChips from "@/components/public/ca/CaFilterChips";
import CaLeadForm from "@/components/public/ca/CaLeadForm";
import CaStickyCTA from "@/components/public/ca/CaStickyCTA";
import CaPdfButton from "@/components/public/ca/CaPdfButton";
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
      <section className="bg-gradient-to-br from-[var(--navy)] to-[#13306e] text-white">
        <div className="container-wide py-12 sm:py-16">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--gold)]">UPSC Current Affairs</p>
            <h1 className="mt-2 max-w-3xl font-heading text-3xl font-extrabold leading-tight sm:text-5xl">
              Daily current affairs, monthly PDFs & exam-ready analysis
            </h1>
            <p className="mt-4 max-w-2xl text-white/80">
              Curated for Prelims & Mains — concise, source-backed and updated every day. Read, revise and download.
            </p>
          </Reveal>
          <Stagger className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { href: "#today", icon: "📅", label: "Today's CA" },
              { href: "/current-affairs/daily", icon: "🗂", label: "Daily Archive" },
              { href: "/current-affairs/monthly", icon: "📘", label: "Monthly PDFs" },
              { href: "#categories", icon: "🧭", label: "Browse Topics" },
            ].map((c) => (
              <StaggerItem key={c.label}>
                <Link href={c.href} className="frost flex flex-col gap-1 rounded-2xl p-4 text-white transition hover:bg-white/15">
                  <span className="text-2xl">{c.icon}</span>
                  <span className="text-sm font-semibold">{c.label}</span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <div className="container-wide py-10">
        {/* Filters + search */}
        <div className="mb-8 space-y-4">
          <CaFilterChips />
          <form action="/current-affairs" className="flex gap-2">
            <input name="q" defaultValue={q} placeholder="Search current affairs…" className="input max-w-md" />
            {type && <input type="hidden" name="type" value={type} />}
            <button className="btn btn-secondary text-sm">Search</button>
          </form>
        </div>

        {isFiltering ? (
          <section>
            <h2 className="mb-4 font-heading text-2xl font-bold">{sorted.length} result{sorted.length === 1 ? "" : "s"}</h2>
            {pageItems.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface p-8 text-center text-ink2">No articles match these filters. <Link href="/current-affairs" className="text-primary">Clear filters</Link></p>
            ) : (
              <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {pageItems.map((a) => <StaggerItem key={a.id}><CaArticleCard article={a} /></StaggerItem>)}
              </Stagger>
            )}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3 text-sm">
                {page > 1 && <Link href={buildHref({ page: page - 1 })} className="btn btn-secondary">← Prev</Link>}
                <span className="text-ink2">Page {page} of {totalPages}</span>
                {page < totalPages && <Link href={buildHref({ page: page + 1 })} className="btn btn-secondary">Next →</Link>}
              </div>
            )}
          </section>
        ) : (
          <>
            {/* Today's CA */}
            {todayGroup && (
              <section id="today" className="scroll-mt-24">
                <div className="mb-4 flex items-end justify-between">
                  <h2 className="font-heading text-2xl font-bold">Today&apos;s Current Affairs</h2>
                  <span className="text-sm text-muted">{caDateLabel(todayGroup.date)}</span>
                </div>
                <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {todayGroup.items.slice(0, 6).map((a) => <StaggerItem key={a.id}><CaArticleCard article={a} /></StaggerItem>)}
                </Stagger>
              </section>
            )}

            {/* Category grid */}
            <section id="categories" className="mt-14 scroll-mt-24">
              <h2 className="mb-4 font-heading text-2xl font-bold">Browse by topic</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {DEFAULT_CA_CATEGORIES.map((c) => (
                  <Link key={c.slug} href={`/current-affairs/category/${c.slug}`} className="card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                    <span className="text-2xl">{c.icon}</span>
                    <span className="text-sm font-semibold leading-tight">{c.name}</span>
                  </Link>
                ))}
              </div>
            </section>

            {/* Monthly PDFs */}
            {monthlyPdfs.length > 0 && (
              <section className="mt-14">
                <div className="mb-4 flex items-end justify-between">
                  <h2 className="font-heading text-2xl font-bold">Monthly compilations</h2>
                  <Link href="/current-affairs/monthly" className="text-sm text-primary">View all →</Link>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {monthlyPdfs.map((p) => (
                    <div key={p.id} className="card flex flex-col p-4">
                      <span className="text-3xl">📘</span>
                      <p className="mt-2 font-semibold leading-tight">{p.title}</p>
                      <p className="text-xs text-muted">{caMonthLabel(p.date_ref)}</p>
                      <div className="mt-3"><CaPdfButton pdf={p} /></div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Recent by date */}
            {groups.length > 1 && (
              <section className="mt-14">
                <h2 className="mb-4 font-heading text-2xl font-bold">Recent days</h2>
                <div className="space-y-8">
                  {groups.slice(1, 4).map((g) => (
                    <div key={g.date}>
                      <h3 className="mb-3 text-sm font-semibold text-ink2">{caDateLabel(g.date)}</h3>
                      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                        {g.items.slice(0, 3).map((a) => <CaArticleCard key={a.id} article={a} compact />)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 text-center"><Link href="/current-affairs/daily" className="btn btn-secondary text-sm">See full daily archive →</Link></div>
              </section>
            )}

            {/* Trending + most downloaded */}
            {(trending.length > 0 || mostDownloaded.length > 0) && (
              <section className="mt-14 grid gap-6 lg:grid-cols-2">
                {trending.length > 0 && (
                  <div className="card p-6">
                    <h2 className="mb-3 font-heading text-xl font-bold">🔥 Trending</h2>
                    <ol className="space-y-3">
                      {trending.map((a, i) => (
                        <li key={a.id} className="flex gap-3">
                          <span className="font-heading text-lg font-extrabold text-[var(--gold)]">{i + 1}</span>
                          <Link href={`/current-affairs/${a.slug}`} className="text-sm font-medium hover:text-primary">{a.title}</Link>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {mostDownloaded.length > 0 && (
                  <div className="card p-6">
                    <h2 className="mb-3 font-heading text-xl font-bold">⬇ Most downloaded</h2>
                    <div className="space-y-3">{mostDownloaded.map((p) => <CaPdfButton key={p.id} pdf={p} />)}</div>
                  </div>
                )}
              </section>
            )}

            {/* Lead capture */}
            <section className="mt-14"><CaLeadForm source="ca-hub" /></section>
          </>
        )}
      </div>

      <CaStickyCTA />
    </div>
  );
}
