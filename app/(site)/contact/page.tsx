import Reveal from "@/components/ui/Reveal";
import LeadForm from "@/components/public/LeadForm";
import { ACADEMY, SUPPORT } from "@/lib/config";

export const metadata = { title: "Contact — Naman Sharma IAS Academy" };

export default function ContactPage() {
  return (
    <div className="container-wide section">
      <Reveal>
        <p className="pill pill-blue mb-3">Contact</p>
        <h1 className="text-4xl font-extrabold sm:text-5xl">We&apos;d love to hear from you</h1>
      </Reveal>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <Reveal>
          <div className="space-y-4">
            <div className="card p-5">
              <p className="text-sm text-muted">Address</p>
              <p className="font-medium">{ACADEMY.address}</p>
            </div>
            <div className="card p-5">
              <p className="text-sm text-muted">Phone</p>
              <p className="font-medium">{SUPPORT.phone}</p>
            </div>
            <div className="card p-5">
              <p className="text-sm text-muted">Email</p>
              <p className="font-medium">{SUPPORT.email}</p>
            </div>
            <div className="card overflow-hidden p-0">
              <iframe
                title="Map"
                src="https://www.google.com/maps?q=Sector%2017C%20Chandigarh&output=embed"
                className="h-64 w-full border-0"
                loading="lazy"
              />
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="card p-6 sm:p-8">
            <h3 className="text-xl">Send us a message</h3>
            <p className="mt-1 text-sm text-ink2">Our team will get back to you shortly.</p>
            <div className="mt-5">
              <LeadForm source="Website" campaign="Contact" cta="Send Message" />
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
