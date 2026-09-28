import TrackForm from "@/components/notes/TrackForm";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata = {
  title: "Track order — Naman IAS Notes",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default function TrackPage() {
  noStore();
  return (
    <div className="container-wide px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-lg">
        <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Order tracking</p>
        <h1 className="mt-2 font-heading text-3xl font-bold leading-tight text-[var(--ca-navy)] sm:text-4xl">Where is your order?</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--ca-navy)]/65">
          Use the order number and the phone from checkout. No account needed.
        </p>
      </div>
      <TrackForm />
    </div>
  );
}
