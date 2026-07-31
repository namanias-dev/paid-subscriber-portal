import type { Metadata } from "next";
import Link from "next/link";

/**
 * Public privacy policy for Meta App Review / Live mode.
 * Must stay unauthenticated and free of data fetching — Meta's crawler hits this URL.
 * Contact email matches the public site brand (site_settings.brand.support_email).
 */
const CONTACT_EMAIL = "namanstudycircle@gmail.com";
const LAST_UPDATED = "30 July 2026";

export const metadata: Metadata = {
  title: "Privacy Policy — Naman Sharma IAS Academy",
  description:
    "How Naman Sharma IAS Academy collects and uses information submitted through Meta Lead Ads and other enquiry forms.",
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="container-wide section">
      <p className="pill pill-blue mb-3">Legal</p>
      <h1 className="text-4xl font-extrabold sm:text-5xl">Privacy Policy</h1>
      <p className="mt-3 max-w-2xl text-ink2">
        This policy explains how Naman Sharma IAS Academy (&quot;we&quot;, &quot;us&quot;) handles personal
        information collected when you submit a Meta (Facebook / Instagram) Lead Ads form or other
        enquiry forms on our website.
      </p>
      <p className="mt-2 text-sm text-muted">Last updated: {LAST_UPDATED}</p>

      <div className="prose-legal mt-10 max-w-3xl space-y-8 text-ink2">
        <section>
          <h2 className="text-xl font-bold text-ink">What we collect</h2>
          <p className="mt-2">
            When you submit a Meta Lead Ads form (or a similar enquiry form), we may receive:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>Name</li>
            <li>Phone number</li>
            <li>Email address</li>
            <li>City</li>
            <li>Any other answers you provide on that form</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Why we collect it</h2>
          <p className="mt-2">
            We use this information solely to contact prospective students about our courses,
            webinars, counselling, and admissions. We do not use Lead Ads data for unrelated
            marketing lists sold to others.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Sharing</h2>
          <p className="mt-2">
            We do not sell or share this data with third parties for their own marketing. Service
            providers that host our systems (for example our website host and database) may process
            data only to operate this service on our behalf.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Storage and retention</h2>
          <p className="mt-2">
            Data is stored securely in our systems and retained only as long as needed for admissions
            follow-up and related student records, or as required by applicable law.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Data deletion requests</h2>
          <p className="mt-2">
            To request deletion or correction of your personal data, email us at{" "}
            <a className="font-medium text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            . Please include the phone number or email you used on the form so we can locate your
            record.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink">Contact</h2>
          <p className="mt-2">
            Naman Sharma IAS Academy
            <br />
            Email:{" "}
            <a className="font-medium text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            <br />
            Website:{" "}
            <Link href="/contact" className="font-medium text-primary hover:underline">
              Contact page
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
