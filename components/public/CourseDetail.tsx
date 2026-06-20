"use client";

import { useState } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/dates";
import { discountPct } from "@/components/public/CourseCard";
import Accordion from "@/components/ui/Accordion";
import CourseCard from "@/components/public/CourseCard";
import CoverImage from "@/components/public/CoverImage";
import ContactButtons from "@/components/public/ContactButtons";
import ResourceList from "@/components/public/ResourceList";
import type { Course } from "@/lib/types";

const TABS = ["Overview", "Curriculum", "Schedule", "Faculty", "What's Included", "Fees & EMI", "FAQs"];

const COURSE_FAQ = [
  { q: "Will I get recordings?", a: "Yes, recordings are available for all live sessions for the duration of your access." },
  { q: "Is there doubt support?", a: "Yes, doubts are addressed in dedicated sessions and via the community." },
  { q: "Can I pay in installments?", a: "Most programs support EMI. See the Fees & EMI tab for details." },
];

export default function CourseDetail({ course, related, comparison }: { course: Course; related: Course[]; comparison: Course[] }) {
  const [tab, setTab] = useState("Overview");
  const off = discountPct(course.price, course.original_price);
  const faqs = (course.faqs || []).filter((f) => f.q?.trim());
  const faqItems = faqs.length ? faqs : COURSE_FAQ;

  return (
    <div className="container-wide section">
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main */}
        <div className="lg:col-span-2">
          <CoverImage src={course.cover_image_url || course.image} mobileSrc={course.mobile_image_url} alt={course.title} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill pill-blue">{course.category}</span>
            {course.modes.map((m) => (
              <span key={m} className="pill pill-gray">{m}</span>
            ))}
            <span className="pill pill-saffron">{course.language}</span>
          </div>
          <h1 className="mt-4 text-3xl font-extrabold sm:text-4xl">{course.title}</h1>
          <p className="mt-3 text-ink2">{course.description}</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-ink2">
            <span>🎯 Target: {course.target_years}</span>
            {course.duration && <span>⏱ {course.duration}</span>}
            {course.seats_left != null && <span>🪑 {course.seats_left} seats left</span>}
            <span>👨‍🏫 {course.faculty}</span>
          </div>

          {/* Tabs */}
          <div className="no-scrollbar mt-8 flex gap-2 overflow-x-auto border-b border-line">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition"
                style={{
                  borderColor: tab === t ? "var(--primary)" : "transparent",
                  color: tab === t ? "var(--primary)" : "var(--ink2)",
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {tab === "Overview" && (
              <div className="space-y-4 text-ink2">
                <p>{course.long_description || course.description}</p>
                {comparison.length > 1 && (
                  <div className="card mt-6 overflow-x-auto p-0">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                          <th className="p-3">Foundation program</th>
                          <th className="p-3">Mode</th>
                          <th className="p-3">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.map((c) => (
                          <tr key={c.id} className="border-b border-line last:border-0">
                            <td className="p-3 font-medium text-ink">{c.title}</td>
                            <td className="p-3">{c.modes.join(", ")}</td>
                            <td className="p-3">{formatINR(c.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === "Curriculum" && (
              <div className="space-y-3">
                {course.curriculum.map((m, i) => (
                  <div key={i} className="card p-4">
                    <p className="font-semibold">{m.title}</p>
                    <ul className="mt-2 space-y-1 text-sm text-ink2">
                      {m.lectures.map((l, j) => (
                        <li key={j} className="flex items-center justify-between">
                          <span>▸ {l.title}</span>
                          {l.duration && <span className="text-muted">{l.duration}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {tab === "Schedule" && <p className="text-ink2">{course.schedule || "Schedule will be shared on enrollment."}</p>}

            {tab === "Faculty" && (
              <div className="card p-5">
                <p className="font-heading text-lg">{course.faculty}</p>
                <p className="mt-1 text-sm text-ink2">9+ years mentoring UPSC aspirants with a personal, results-focused approach.</p>
              </div>
            )}

            {tab === "What's Included" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="card p-5">
                  <p className="mb-2 font-semibold text-success">✓ Included</p>
                  <ul className="space-y-1.5 text-sm text-ink2">
                    {course.included.map((x) => <li key={x}>✓ {x}</li>)}
                  </ul>
                </div>
                <div className="card p-5">
                  <p className="mb-2 font-semibold text-danger">✕ Not included</p>
                  <ul className="space-y-1.5 text-sm text-ink2">
                    {course.not_included.map((x) => <li key={x}>✕ {x}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {tab === "Fees & EMI" && (
              <div className="card p-5 text-sm text-ink2">
                <p className="text-ink">One-time fee: <b>{formatINR(course.price)}</b>{course.gst && " + GST"}</p>
                {course.emi_amount && <p className="mt-2">EMI available from <b className="text-ink">{formatINR(course.emi_amount)}/mo</b> for {course.emi_months} months.</p>}
                {course.brochure_link && (
                  <a href={course.brochure_link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary mt-4">
                    ⬇ Download Brochure
                  </a>
                )}
              </div>
            )}

            {tab === "FAQs" && <Accordion items={faqItems} />}
          </div>

          {(course.pdf_resources || []).length > 0 && (
            <div className="mt-10">
              <h2 className="text-2xl font-extrabold">Downloads & resources</h2>
              <div className="mt-4">
                <ResourceList resources={course.pdf_resources} />
              </div>
            </div>
          )}

          {(course.contact_links || []).length > 0 && (
            <div className="mt-10">
              <h2 className="text-2xl font-extrabold">Talk to us</h2>
              <p className="mb-3 text-sm text-ink2">Questions about this program? Reach out directly.</p>
              <ContactButtons links={course.contact_links} />
            </div>
          )}

          {related.length > 0 && (
            <div className="mt-12">
              <h2 className="text-2xl font-extrabold">Related courses</h2>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {related.map((c) => <CourseCard key={c.id} course={c} />)}
              </div>
            </div>
          )}
        </div>

        {/* Sticky enroll card */}
        <div>
          <div className="lg:sticky lg:top-24">
            <div className="card p-6">
              {off && <span className="pill pill-green mb-2">{off}% OFF — limited time</span>}
              <div className="flex items-baseline gap-2">
                {course.price === 0 ? (
                  <span className="font-heading text-3xl text-india">Free</span>
                ) : (
                  <>
                    <span className="font-heading text-3xl">{formatINR(course.price)}</span>
                    {course.original_price && <span className="text-muted line-through">{formatINR(course.original_price)}</span>}
                  </>
                )}
              </div>
              {course.emi_amount && <p className="mt-1 text-sm text-ink2">or EMI from {formatINR(course.emi_amount)}/mo</p>}

              <Link href={`/enroll/${course.slug}`} className="btn btn-primary mt-5 w-full">
                {course.price === 0 ? "Book Now" : "Enroll Now →"}
              </Link>
              <Link href="/demo" className="btn btn-secondary mt-2 w-full">Book a Free Demo</Link>

              <ul className="mt-5 space-y-2 text-sm text-ink2">
                {course.included.slice(0, 4).map((x) => <li key={x}>✓ {x}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
