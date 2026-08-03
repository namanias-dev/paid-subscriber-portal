import { Suspense } from "react";
import { CalendarX } from "lucide-react";
import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import WebinarCard from "@/components/public/WebinarCard";
import FeaturedWebinarHero from "@/components/public/FeaturedWebinarHero";
import WebinarRegister from "@/components/public/WebinarRegister";
import { getPublicWebinars, getWebinarRegisteredCounts } from "@/lib/dataProvider";
import { getPurchaseSnapshot, webinarPurchased } from "@/lib/purchaseStatus";
import { canRegisterForWebinar } from "@/lib/webinarLifecycle";

export const metadata = { title: "Webinars — Naman Sharma IAS Academy" };

// ISR: ordinary visits served from cache → zero live Postgres on a warm path.
export const revalidate = 300;
export const maxDuration = 20;

export default async function WebinarsPage() {
  let webinars: Awaited<ReturnType<typeof getPublicWebinars>> = [];
  let snapshot: Awaited<ReturnType<typeof getPurchaseSnapshot>> = null;
  let regCounts = new Map<string, number>();
  let dbFailed = false;
  try {
    webinars = await getPublicWebinars();
    snapshot = await getPurchaseSnapshot().catch(() => null);
    regCounts = await getWebinarRegisteredCounts(webinars).catch(() => new Map());
  } catch {
    dbFailed = true;
  }

  if (dbFailed) {
    return (
      <div className="container-wide py-16 text-center">
        <h1 className="font-heading text-2xl font-bold">Webinars temporarily unavailable</h1>
        <p className="mt-2 text-sm text-[var(--ca-slate-700)]">Please refresh in a moment.</p>
      </div>
    );
  }

  const featured =
    webinars
      .filter((w) => w.status !== "completed" && canRegisterForWebinar(w))
      .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())[0] || null;
  const featuredRegistered = featured ? webinarPurchased(featured, snapshot) : false;
  const others = featured ? webinars.filter((w) => w.id !== featured.id) : webinars;

  return (
    <div className="bg-[var(--ca-slate-50)]">
      <header className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 240, height: 240, top: -100, right: -60, background: "rgba(212,175,55,0.14)" }} />
        <div className="container-wide relative py-2.5 text-center sm:py-4">
          <h1 className="font-heading text-base font-bold leading-snug tracking-tight text-white sm:text-xl">
            Live masterclasses to level up your UPSC prep
          </h1>
        </div>
      </header>

      <div className="relative z-10 bg-[var(--ca-slate-50)]">
        {featured && (
          <div className="container-wide pt-2 sm:pt-4">
            <FeaturedWebinarHero
              webinar={featured}
              registered={featuredRegistered}
              registeredCount={regCounts.get(featured.id) ?? 0}
            />
          </div>
        )}

        <div className="container-wide py-8 sm:py-10">
          {webinars.length === 0 ? (
            <div className="mx-auto max-w-md rounded-2xl border border-[var(--ca-slate-200)] bg-white p-10 text-center shadow-soft">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ca-slate-50)] text-[var(--ca-slate-400)]">
                <CalendarX size={22} aria-hidden="true" />
              </span>
              <p className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">No upcoming webinars yet</p>
              <p className="mt-1 text-sm text-[var(--ca-slate-700)]">New sessions are announced regularly — check back soon.</p>
            </div>
          ) : others.length > 0 ? (
            <Reveal>
              <h2 className="mb-4 font-heading text-lg font-bold text-[var(--ca-navy-900)]">
                {featured ? "More webinars & recordings" : "Webinars & events"}
              </h2>
              <Stagger className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {others.map((w) => (
                  <StaggerItem key={w.id}>
                    <WebinarCard webinar={w} registered={webinarPurchased(w, snapshot)} registeredCount={regCounts.get(w.id) ?? 0} />
                  </StaggerItem>
                ))}
              </Stagger>
            </Reveal>
          ) : null}
        </div>

        {featured && !featuredRegistered && (
          <div className="container-wide pb-10 sm:pb-12">
            <section id="register" className="scroll-mt-24 overflow-hidden rounded-2xl border border-[var(--ca-slate-200)] bg-white p-6 shadow-soft sm:p-8">
              <h3 className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">Reserve your spot</h3>
              <p className="mt-1 mb-3 text-sm text-[var(--ca-slate-700)]">Limited seats — register in seconds.</p>
              <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-[var(--ca-slate-100)]" />}>
                <WebinarRegister
                  webinarId={featured.id}
                  webinarSlug={featured.slug}
                  price={featured.price}
                  entryPoint="listing"
                />
              </Suspense>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
