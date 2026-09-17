import TrackForm from "@/components/notes/TrackForm";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata = { title: "Track order — Naman IAS Notes" };

export default function TrackPage() {
  noStore();
  return (
    <div className="container-wide py-12">
      <h1 className="font-heading text-3xl font-bold text-[var(--ca-navy)]">Track your notes</h1>
      <p className="mt-2 text-sm text-[var(--ca-navy)]/60">Order number and the phone used at checkout. No login.</p>
      <TrackForm />
    </div>
  );
}
