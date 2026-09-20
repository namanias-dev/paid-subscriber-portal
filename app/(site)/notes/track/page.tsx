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
    <div className="container-wide py-12">
      <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Delivery</p>
      <h1 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">Track your notes</h1>
      <p className="mt-2 text-sm text-[var(--ca-navy)]/60">Order number and the phone used at checkout. No login. Courier events appear only when they actually exist.</p>
      <TrackForm />
    </div>
  );
}
