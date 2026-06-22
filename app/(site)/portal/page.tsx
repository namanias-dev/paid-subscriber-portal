import Link from "next/link";
import { redirect } from "next/navigation";
import { getBuyerSession } from "@/lib/session";
import { getBuyerByPhone, getBuyerPurchases } from "@/lib/dataProvider";
import { formatINR } from "@/lib/dates";
import type { Payment } from "@/lib/types";
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

interface Group {
  key: string;
  type: string;
  title: string;
  count: number;
  latest: Payment;
  items: Payment[];
}

/** Group purchases by unique item so a phone that bought the same webinar twice
 * shows ONE clean card with an enrollment count + expandable history. */
function groupPurchases(purchases: Payment[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of purchases) {
    const key = `${p.item_type}|${p.item_slug || p.item}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.items.push(p);
      if (new Date(p.created_at) > new Date(existing.latest.created_at)) existing.latest = p;
    } else {
      map.set(key, { key, type: p.item_type, title: p.item, count: 1, latest: p, items: [p] });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime()
  );
}

export default async function PortalDashboardPage() {
  const session = await getBuyerSession();
  if (!session) redirect("/portal/login");

  const [buyer, purchases] = await Promise.all([
    getBuyerByPhone(session.phone),
    getBuyerPurchases(session.phone),
  ]);
  const groups = groupPurchases(purchases);

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

      {groups.length === 0 ? (
        <div className="mt-10 card p-8 text-center">
          <p className="text-lg font-semibold">No purchases found yet</p>
          <p className="mt-1 text-sm text-ink2">If you&apos;ve just paid, it can take a moment to appear. Refresh shortly.</p>
          <Link href="/courses" className="btn btn-primary mt-5">Browse courses →</Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => {
            const meta = TYPE_META[g.type] || TYPE_META.item;
            return (
              <div key={g.key} className="card flex h-full flex-col p-5">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{meta.icon}</span>
                  <div className="flex items-center gap-1.5">
                    {g.count > 1 && (
                      <span className="pill pill-blue text-xs">Registered {g.count}×</span>
                    )}
                    <span className="pill pill-gray text-xs">{meta.label}</span>
                  </div>
                </div>
                <h3 className="mt-3 text-base font-semibold leading-snug">{g.title}</h3>
                <div className="mt-2 text-xs text-muted">Latest: {fmtDate(g.latest.created_at)}</div>

                <Link
                  href={`/portal/item/${encodeURIComponent(g.latest.reference_no || g.latest.id)}`}
                  className="btn btn-primary mt-4 w-full text-sm"
                >
                  Open content →
                </Link>

                {g.count > 1 && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-primary">View {g.count} enrollments</summary>
                    <ul className="mt-2 space-y-2">
                      {g.items.map((p) => (
                        <li key={p.id} className="rounded-lg border border-line p-2 text-xs">
                          <div className="font-medium">{p.student_name || "—"}</div>
                          <div className="text-muted">{fmtDate(p.created_at)} · {p.amount > 0 ? formatINR(p.amount) : "Free"}</div>
                          <div className="truncate font-mono text-[10px] text-muted">{p.reference_no}</div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
