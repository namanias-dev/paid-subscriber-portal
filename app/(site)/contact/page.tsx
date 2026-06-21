import Reveal from "@/components/ui/Reveal";
import LeadForm from "@/components/public/LeadForm";
import { getSiteSettings } from "@/lib/dataProvider";
import { whatsappLink } from "@/lib/phone";
import { directionsUrl, mapEmbedUrl } from "@/lib/maps";

export const metadata = { title: "Contact — Naman Sharma IAS Academy" };
export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const { brand } = await getSiteSettings();
  const wa = whatsappLink(brand.whatsapp || brand.support_phone);

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
              <p className="font-medium">{brand.address}</p>
              <a href={directionsUrl(brand)} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-3 text-sm">📍 Get Directions</a>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="card p-5">
                <p className="text-sm text-muted">Phone</p>
                <a href={`tel:${brand.support_phone}`} className="font-medium hover:text-primary">{brand.support_phone}</a>
              </div>
              {wa && (
                <div className="card p-5">
                  <p className="text-sm text-muted">WhatsApp</p>
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-primary">{brand.whatsapp || brand.support_phone}</a>
                </div>
              )}
            </div>
            <div className="card p-5">
              <p className="text-sm text-muted">Email</p>
              <a href={`mailto:${brand.support_email}`} className="font-medium hover:text-primary">{brand.support_email}</a>
            </div>
            <div className="card overflow-hidden p-0">
              <iframe
                title="Map"
                src={mapEmbedUrl(brand)}
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
