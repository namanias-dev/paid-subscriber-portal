import Link from "next/link";
import CartBadge from "./CartBadge";

const LINKS = [
  { href: "/notes", label: "All notes" },
  { href: "/notes/current-affairs", label: "CA Compilations" },
  { href: "/notes/track", label: "Track order" },
];

export default function StoreSubnav() {
  return (
    <div className="sticky top-[var(--header-h,4rem)] z-20 border-b border-[var(--ca-navy)]/10 bg-[var(--ca-surface)]/95 backdrop-blur ns-elev-4">
      <div className="container-wide flex items-center justify-between gap-3 py-2.5">
        <nav aria-label="Notes store" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium text-[var(--ca-navy)]">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="ca-focus hover:text-[var(--ca-gold-dark)]">
              {l.label}
            </Link>
          ))}
        </nav>
        <CartBadge />
      </div>
    </div>
  );
}
