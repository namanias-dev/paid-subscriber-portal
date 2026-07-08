import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import CareersList, { type PositionCardData } from "@/components/public/careers/CareersList";
import { listOpenPositions, getCareersSettings } from "@/lib/careers/store";
import { formatSalaryRange, JOB_TYPE_LABELS, ROLE_TYPE_LABELS } from "@/lib/careers/config";
import { SITE_URL, ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Careers — Join Naman IAS Academy",
  description:
    "Work with one of Chandigarh's top IAS academies. Explore open roles for faculty, video editors and more — and help make UPSC education affordable.",
  alternates: { canonical: `${SITE_URL}/careers` },
  openGraph: {
    title: "Careers — Join Naman IAS Academy",
    description: "Explore open roles at Naman IAS Academy and help make UPSC education affordable.",
    url: `${SITE_URL}/careers`,
    type: "website",
    siteName: ACADEMY.name,
  },
};

export default async function CareersPage() {
  const [positions, settings] = await Promise.all([listOpenPositions(), getCareersSettings()]);

  const cards: PositionCardData[] = positions.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    roleType: p.role_type,
    roleLabel: ROLE_TYPE_LABELS[p.role_type] || p.role_type,
    jobType: p.job_type,
    jobLabel: JOB_TYPE_LABELS[p.job_type] || p.job_type,
    location: [p.location_city, p.location_state].filter(Boolean).join(", "),
    city: p.location_city || "",
    salary: formatSalaryRange(p.salary_min, p.salary_max, p.salary_currency, p.salary_period),
    subjects: p.subjects,
    summary: p.summary,
  }));

  const acceptingApplications = settings.accepting_applications;

  return (
    <div className="bg-[var(--ca-slate-50)]">
      {/* Hero */}
      <header className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 320, height: 320, top: -130, right: -70, background: "rgba(212,175,55,0.16)" }} />
        <div className="ca-orb" style={{ width: 260, height: 260, bottom: -150, left: -60, background: "rgba(30,58,138,0.5)" }} />
        <div className="container-wide relative py-14 text-center sm:py-20">
          <p className="ca-eyebrow">Careers at {ACADEMY.shortName}</p>
          <h1 className="ca-hero-title mx-auto mt-3 max-w-3xl font-heading text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            Build a career that makes UPSC education affordable
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[var(--ca-slate-300)]">
            Join one of Chandigarh&apos;s top IAS academies. We&apos;re looking for passionate,
            confident people — faculty, editors and more — who want to shape India&apos;s next generation of civil servants.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="ca-badge ca-badge-gold">🇮🇳 {ACADEMY.address}</span>
            <span className="ca-badge ca-badge-glass">{positions.length} open {positions.length === 1 ? "role" : "roles"}</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 -mt-10 rounded-t-[2rem] bg-[var(--ca-slate-50)] sm:-mt-12">
        <div className="container-wide py-10 sm:py-12">
          {!acceptingApplications ? (
            <EmptyCard
              title="We're not accepting applications right now"
              body="Thank you for your interest in joining Naman IAS Academy. Please check back soon — new openings are announced regularly."
            />
          ) : cards.length === 0 ? (
            <EmptyCard
              title="No open positions right now"
              body="There are no roles open at the moment. Check back soon — we're growing fast and new openings are announced regularly."
            />
          ) : (
            <CareersList positions={cards} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-[var(--ca-slate-200)] bg-white p-10 text-center shadow-soft">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ca-slate-50)] text-[var(--ca-slate-400)]">
        <Briefcase size={22} aria-hidden="true" />
      </span>
      <p className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--ca-slate-700)]">{body}</p>
    </div>
  );
}
