import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ArrowRight, Compass, Flame, Sparkles } from "lucide-react";
import { CaIconChip } from "@/components/public/ca/CaIcons";
import { appIcon } from "@/lib/appIcons";
import { getPublicResources } from "@/lib/dataProvider";
import { journeyResources, resourceMetadata } from "@/lib/resourceView";
import { RESOURCE_CATEGORIES } from "@/lib/resourceConstants";
import { ACADEMY } from "@/lib/config";
import ResourceCard from "@/components/public/resources/ResourceCard";
import JourneyRoadmap from "@/components/public/resources/JourneyRoadmap";
import ResourceSearch from "@/components/public/resources/ResourceSearch";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return resourceMetadata({
    title: `UPSC Resources — Free Guides, Strategy & Booklists | ${ACADEMY.shortName}`,
    description:
      "Free, structured UPSC preparation resources by Naman Sir — a Day-1-to-exam roadmap for beginners, syllabus & pattern, best books, prelims & mains strategy, and answer writing.",
    path: "/resources",
  });
}

export default async function ResourcesHub() {
  const all = await getPublicResources();
  const journey = journeyResources(all);
  const popular = [...all].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 6);
  const searchItems = all.map((r) => ({ slug: r.slug, title: r.title, summary: r.summary, category: r.category, tags: r.tags }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "UPSC Resources",
    description: "Free UPSC preparation guides, strategy and booklists by Naman Sharma IAS Academy.",
    url: `${(process.env.NEXT_PUBLIC_SITE_URL || "https://namanias.com").replace(/\/$/, "")}/resources`,
  };

  return (
    <div className="pb-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Hero */}
      <section className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 340, height: 340, top: -140, right: -80, background: "rgba(212,175,55,0.18)" }} />
        <div className="container-wide relative py-16 sm:py-20">
          <p className="ca-eyebrow flex items-center gap-1.5"><BookOpen size={14} /> UPSC Resources</p>
          <h1 className="mt-3 max-w-3xl font-heading text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl">
            Your complete UPSC roadmap — from Day 1 to the exam hall
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--ca-slate-300)]">
            Free, structured guides by Naman Sir — syllabus & pattern, the right books, prelims & mains strategy, and a step-by-step beginner journey. No clutter, just what actually works.
          </p>
          <div className="mt-8"><ResourceSearch items={searchItems} /></div>
        </div>
      </section>

      <div className="container-wide">
        {/* Categories */}
        <section className="py-12">
          <h2 className="font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)]">Explore by topic</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RESOURCE_CATEGORIES.map((c) => (
              <Link key={c.slug} href={`/resources/${c.slug}`} className="ca-card ca-focus group flex items-start gap-4 p-5">
                <CaIconChip icon={appIcon(c.icon)} variant="light" size={20} />
                <div>
                  <h3 className="font-heading font-bold text-[var(--ca-navy-900)] group-hover:text-[var(--ca-navy-600)]">{c.name}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--ca-slate-700)]">{c.blurb}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Journey roadmap */}
        {journey.length > 0 && (
          <section className="py-6">
            <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
              <div>
                <p className="ca-eyebrow flex items-center gap-1.5 text-[var(--ca-navy-600)]"><Compass size={14} /> Start here</p>
                <h2 className="mt-2 font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)]">UPSC Preparation Roadmap — Day 1 to Exam</h2>
                <p className="mt-3 max-w-xl text-[var(--ca-slate-700)]">
                  New to UPSC? Read these guides in order. Each step builds on the last, taking you from “where do I even start?” to a confident, exam-ready strategy.
                </p>
                <div className="mt-8"><JourneyRoadmap resources={journey} /></div>
              </div>
              <aside className="lg:pt-24">
                <div className="ca-card sticky top-24 p-6">
                  <h3 className="flex items-center gap-2 font-heading text-lg font-bold text-[var(--ca-navy-900)]"><Sparkles size={18} className="text-[var(--ca-gold)]" /> New to UPSC?</h3>
                  <p className="mt-2 text-sm text-[var(--ca-slate-700)]">Join Naman Sir&apos;s free live masterclass and get a personalised plan for your preparation.</p>
                  <Link href="/webinars" className="ca-btn ca-btn-gold ca-focus mt-4 w-full justify-center">Join free masterclass <ArrowRight size={16} /></Link>
                  <Link href="/courses" className="ca-btn ca-btn-outline ca-focus mt-3 w-full justify-center">Explore courses</Link>
                </div>
              </aside>
            </div>
          </section>
        )}

        {/* Popular / all guides */}
        {popular.length > 0 && (
          <section className="py-14">
            <h2 className="flex items-center gap-2 font-heading text-2xl font-bold tracking-tight text-[var(--ca-navy-900)]"><Flame size={20} className="text-[var(--ca-gold)]" /> Popular guides</h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {popular.map((r) => <ResourceCard key={r.id} resource={r} />)}
            </div>
          </section>
        )}

        {all.length === 0 && (
          <section className="py-20 text-center">
            <p className="text-[var(--ca-slate-400)]">Fresh UPSC guides are being prepared. Check back soon.</p>
          </section>
        )}
      </div>
    </div>
  );
}
