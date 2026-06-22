import Link from "next/link";
import { redirect } from "next/navigation";
import { getBuyerSession } from "@/lib/session";
import { getBuyerByPhone, getBuyerPurchases } from "@/lib/dataProvider";
import { formatINR } from "@/lib/dates";
import PortalLogoutButton from "@/components/portal/PortalLogoutButton";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "My Portal — Naman Sharma IAS Academy",
  robots: { index: false, follow: false },
};

const TYPE_META: Record<string, { label: string; icon: string }> = {
  course: { label: "Course", icon: "🎓" },
  webinar: { label: "Webinar", icon: "🎥" },
  plan: { label: "Subscription", icon: "💎" },
  item: { label: "Purchase", icon: "📦" },
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export default async function PortalDashboardPage() {
  const session = await getBuyerSession();
  if (!session) redirect("/portal/login");

  const [buyer, purchases] = await Promise.all([
    getBuyerByPhone(session.phone),
    getBuyerPurchases(session.phone),
  ]);

  return (
    <div className="container-wide section">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="pill pill-blue mb-3">My Portal</p>
          <h1 className="text-3xl font-extrabold sm:text-4xl">
            {session.name ? `Welcome, ${session.name.split(" ")[0]}` : "Welcome"}
          </h1>
          <p className="mt-2 text-ink2">Everything you&apos;ve purchased, all in one place.</p>
        </div>
        <PortalLogoutButton />
      </div>

      {buyer && (
        <div className="mt-6 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm">
          <span className="text-muted">Your login code:</span>
          <span className="font-mono font-bold tracking-[0.2em] text-primary">{buyer.login_code}</span>
        </div>
      )}

      {purchases.length === 0 ? (
        <div className="mt-10 card p-8 text-center">
          <p className="text-lg font-semibold">No purchases found yet</p>
          <p className="mt-1 text-sm text-ink2">If you&apos;ve just paid, it can take a moment to appear. Refresh shortly.</p>
          <Link href="/courses" className="btn btn-primary mt-5">Browse courses →</Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {purchases.map((p) => {
            const meta = TYPE_META[p.item_type] || TYPE_META.item;
            return (
              <Link
                key={p.id}
                href={`/portal/item/${encodeURIComponent(p.reference_no || p.id)}`}
                className="card card-hover flex h-full flex-col p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{meta.icon}</span>
                  <span className="pill pill-gray text-xs">{meta.label}</span>
                </div>
                <h3 className="mt-3 text-base font-semibold leading-snug">{p.item}</h3>
                <div className="mt-3 space-y-1 text-xs text-muted">
                  <div>Paid: {p.amount > 0 ? formatINR(p.amount) : "Free"}</div>
                  <div>On: {fmtDate(p.created_at)}</div>
                </div>
                <span className="mt-4 text-sm font-semibold text-primary">Open content →</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
