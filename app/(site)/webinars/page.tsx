import Link from "next/link";
import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import { getPublicWebinars } from "@/lib/dataProvider";
import { formatINR, formatISTDateTime } from "@/lib/dates";

export const metadata = { title: "Webinars — Naman Sharma IAS Academy" };

// Always render fresh so newly created/edited webinars appear immediately
// (otherwise this listing is statically prerendered at build time and goes stale).
export const dynamic = "force-dynamic";

export default async function WebinarsPage() {
  const webinars = await getPublicWebinars();
  return (
    <div className="container-wide section">
      <Reveal>
        <p className="pill pill-blue mb-3">Webinars & Events</p>
        <h1 className="text-4xl font-extrabold sm:text-5xl">Free & ₹50 sessions to level up</h1>
        <p className="mt-3 max-w-2xl text-ink2">Masterclasses, strategy seminars and live Q&amp;A with Naman Sir.</p>
      </Reveal>

      <Stagger className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {webinars.map((w) => (
          <StaggerItem key={w.id}>
            <Link href={`/webinars/${w.slug}`} className="card card-hover flex h-full flex-col p-5">
              <div className="flex items-center justify-between">
                <span className={`pill ${w.status === "completed" ? "pill-gray" : "pill-green"}`}>
                  {w.status === "completed" ? "Recording" : "Upcoming"}
                </span>
                <span className="pill pill-blue">{w.price === 0 ? "Free" : formatINR(w.price)}</span>
              </div>
              <h3 className="mt-3 text-lg">{w.title}</h3>
              <p className="mt-1.5 line-clamp-2 flex-1 text-sm text-ink2">{w.description}</p>
              <p className="mt-3 text-sm text-muted">
                {formatISTDateTime(w.datetime)}
              </p>
              <p className="text-xs text-muted">{w.registrations.toLocaleString("en-IN")} registered</p>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
