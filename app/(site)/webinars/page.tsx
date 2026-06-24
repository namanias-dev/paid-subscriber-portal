import { CalendarX } from "lucide-react";
import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import WebinarCard from "@/components/public/WebinarCard";
import { getPublicWebinars } from "@/lib/dataProvider";
import { getPurchaseSnapshot, webinarPurchased } from "@/lib/purchaseStatus";

export const metadata = { title: "Webinars — Naman Sharma IAS Academy" };

// Always render fresh so newly created/edited webinars appear immediately
// (otherwise this listing is statically prerendered at build time and goes stale).
export const dynamic = "force-dynamic";

export default async function WebinarsPage() {
  const webinars = await getPublicWebinars();
  const snapshot = await getPurchaseSnapshot();

  return (
    <div className="bg-[var(--ca-slate-50)]">
      {/* Premium hero */}
      <header className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 320, height: 320, top: -130, right: -70, background: "rgba(212,175,55,0.16)" }} />
        <div className="ca-orb" style={{ width: 260, height: 260, bottom: -150, left: -60, background: "rgba(30,58,138,0.5)" }} />
        <div className="container-wide relative py-14 text-center sm:py-20">
          <p className="ca-eyebrow">Webinars &amp; Events</p>
          <h1 className="ca-hero-title mx-auto mt-3 max-w-3xl font-heading text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            Live masterclasses to level up your UPSC prep
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[var(--ca-slate-300)]">
            Free &amp; ₹50 strategy sessions, doubt-clearing and live Q&amp;A with Naman Sir — with recordings and certificates.
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 -mt-10 rounded-t-[2rem] bg-[var(--ca-slate-50)] sm:-mt-12">
        <div className="container-wide py-10 sm:py-12">
          {webinars.length === 0 ? (
            <div className="mx-auto max-w-md rounded-2xl border border-[var(--ca-slate-200)] bg-white p-10 text-center shadow-soft">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ca-slate-50)] text-[var(--ca-slate-400)]">
                <CalendarX size={22} aria-hidden="true" />
              </span>
              <p className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">No upcoming webinars yet</p>
              <p className="mt-1 text-sm text-[var(--ca-slate-700)]">New sessions are announced regularly — check back soon.</p>
            </div>
          ) : (
            <Reveal>
              <Stagger className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {webinars.map((w) => (
                  <StaggerItem key={w.id}>
                    <WebinarCard webinar={w} registered={webinarPurchased(w, snapshot)} />
                  </StaggerItem>
                ))}
              </Stagger>
            </Reveal>
          )}
        </div>
      </div>
    </div>
  );
}
