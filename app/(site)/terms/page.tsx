import type { Metadata } from "next";
import Link from "next/link";

/**
 * Public Terms of Service for Meta App Review / Live mode.
 * Must stay unauthenticated and free of data fetching — Meta's crawler hits this URL.
 */
const CONTACT_EMAIL = "namanstudycircle@gmail.com";
const LAST_UPDATED = "30 July 2026";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Terms of Service — Naman Sharma IAS Academy",
  description:
    "Terms governing use of the Naman Sharma IAS Academy website, lead forms, and related services.",
  robots: { index: true, follow: true },
};

export default function TermsOfServicePage() {
  return (
    <div className="container-wide section">
      <p className="pill pill-blue mb-3">Legal</p>
      <h1 className="text-4xl font-extrabold sm:text-5xl">Terms of Service</h1>
      <p className="mt-3 max-w-2xl text-ink2">
        These terms govern your use of the Naman Sharma IAS Academy website, Meta Lead Ads forms,
        and related online services (&quot;Services&quot;). By using the Services, you agree to these
        terms.
      </p>
      <p className="mt-2 text-sm text-muted">Last updated: {LAST_UPDATED}</p>

      <div className="mt-10 max-w-3xl space-y-8 text-ink2">
        <section>
          <h2 className="text-xl font-bold text-ink">Who we are</h2>
          <p className="mt-2">
            The Services are operated by Naman Sharma IAS Academy (Chandigarh, India) for UPSC and
            related coaching information, registrations, and admissions enquiries.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Using our Services</h2>
          <p className="mt-2">
            You agree to provide accurate information when submitting lead forms or registrations,
            and to use the Services only for lawful purposes. You must not attempt to disrupt,
            scrape, or misuse the website or our systems.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Lead forms and contact</h2>
          <p className="mt-2">
            If you submit a Meta Lead Ads form or website enquiry, you consent to be contacted by
            our team about courses, webinars, counselling, and admissions using the details you
            provided. See our{" "}
            <Link href="/privacy" className="font-medium text-primary hover:underline">
              Privacy Policy
            </Link>{" "}
            for how that information is handled.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Courses, fees, and content</h2>
          <p className="mt-2">
            Course details, schedules, and fees shown online may change. Enrolment, payment, and
            access to paid content are subject to the specific terms presented at checkout or in
            your student agreement. We may update website content without notice.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Disclaimer</h2>
          <p className="mt-2">
            Educational content and guidance are provided for learning purposes. We do not guarantee
            examination results. To the fullest extent permitted by law, we are not liable for
            indirect or consequential losses arising from use of the Services.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Changes</h2>
          <p className="mt-2">
            We may update these terms from time to time. The &quot;Last updated&quot; date above will
            change when we do. Continued use of the Services after an update constitutes acceptance
            of the revised terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Contact</h2>
          <p className="mt-2">
            Questions about these terms:{" "}
            <a className="font-medium text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            . You can also use our{" "}
            <Link href="/contact" className="font-medium text-primary hover:underline">
              Contact page
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
