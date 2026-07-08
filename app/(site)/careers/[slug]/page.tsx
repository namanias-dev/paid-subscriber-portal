import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin, Briefcase, Clock, ArrowLeft } from "lucide-react";
import ApplicationForm from "@/components/public/careers/ApplicationForm";
import {
  getPositionBySlug,
  getCareersSettings,
  resolveFormFields,
  toPublicPosition,
} from "@/lib/careers/store";
import { formatSalaryRange, JOB_TYPE_LABELS, ROLE_TYPE_LABELS } from "@/lib/careers/config";
import { SITE_URL, ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const p = await getPositionBySlug(params.slug);
  if (!p || p.status === "draft") return { title: "Position not found" };
  const url = `${SITE_URL}/careers/${p.slug}`;
  const title = `${p.title} — Careers at ${ACADEMY.shortName}`;
  const desc = (p.summary || `Apply for ${p.title} at ${ACADEMY.name}.`).slice(0, 170);
  return {
    title,
    description: desc,
    alternates: { canonical: url },
    openGraph: { title, description: desc, url, type: "website", siteName: ACADEMY.name },
  };
}

export default async function PositionDetail({ params }: { params: { slug: string } }) {
  const position = await getPositionBySlug(params.slug);
  if (!position || position.status === "draft") notFound();

  const settings = await getCareersSettings();
  const fields = await resolveFormFields(position);
  const pub = toPublicPosition(position, fields);

  const isOpen = position.status === "open";
  const accepting = isOpen && position.accepting_applications && settings.accepting_applications;
  const location = [position.location_city, position.location_state].filter(Boolean).join(", ");
  const salary = formatSalaryRange(position.salary_min, position.salary_max, position.salary_currency, position.salary_period);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: position.title,
    description: position.description_html || position.summary || position.title,
    datePosted: position.created_at || undefined,
    employmentType: (JOB_TYPE_LABELS[position.job_type] || position.job_type).toUpperCase().replace(/[^A-Z]/g, "_"),
    hiringOrganization: { "@type": "Organization", name: ACADEMY.name, sameAs: SITE_URL },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: position.location_city || undefined,
        addressRegion: position.location_state || undefined,
        addressCountry: "IN",
      },
    },
    ...(position.salary_min || position.salary_max
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: position.salary_currency || "INR",
            value: {
              "@type": "QuantitativeValue",
              minValue: position.salary_min || undefined,
              maxValue: position.salary_max || undefined,
              unitText: position.salary_period === "year" ? "YEAR" : "MONTH",
            },
          },
        }
      : {}),
  };

  return (
    <div className="container-wide section pb-24">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Link href="/careers" className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft size={16} aria-hidden="true" /> All openings
      </Link>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left: details */}
        <div className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill pill-blue">{ROLE_TYPE_LABELS[position.role_type] || position.role_type}</span>
            <span className="pill pill-gray">{JOB_TYPE_LABELS[position.job_type] || position.job_type}</span>
            {!isOpen && <span className="pill pill-red">Closed</span>}
          </div>
          <h1 className="mt-4 text-3xl font-extrabold sm:text-4xl">{position.title}</h1>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink2">
            {location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={16} aria-hidden="true" /> {location}
              </span>
            )}
            {salary && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                <Briefcase size={16} aria-hidden="true" /> {salary}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Clock size={16} aria-hidden="true" /> {JOB_TYPE_LABELS[position.job_type] || position.job_type}
            </span>
          </div>

          {position.summary && <p className="mt-5 text-lg text-ink2">{position.summary}</p>}

          {position.subjects.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold text-ink">Subjects</p>
              <div className="flex flex-wrap gap-2">
                {position.subjects.map((s) => (
                  <span key={s} className="chip">{s}</span>
                ))}
              </div>
            </div>
          )}

          {position.description_html && (
            <section className="mt-8">
              <h2 className="text-2xl font-extrabold">About the role</h2>
              <div className="rich mt-3" dangerouslySetInnerHTML={{ __html: position.description_html }} />
            </section>
          )}

          {position.requirements_html && (
            <section className="mt-8">
              <h2 className="text-2xl font-extrabold">Requirements</h2>
              <div className="rich mt-3" dangerouslySetInnerHTML={{ __html: position.requirements_html }} />
            </section>
          )}
        </div>

        {/* Right: apply */}
        <div>
          <div id="apply" className="card scroll-mt-24 p-6 lg:sticky lg:top-24">
            {accepting ? (
              <ApplicationForm position={pub} subjects={settings.subjects} />
            ) : (
              <>
                <span className="pill pill-gray mb-2">Applications closed</span>
                <h3 className="text-lg font-bold">
                  {isOpen ? "Not accepting applications right now" : "This position is closed"}
                </h3>
                <p className="mt-1 text-sm text-ink2">
                  {isOpen
                    ? "We're not taking new applications for this role at the moment. Please check back soon."
                    : "This role is no longer open. Explore our other openings — we're growing fast."}
                </p>
                <Link href="/careers" className="btn btn-primary mt-4 w-full">View open roles →</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
