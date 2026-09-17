import Link from "next/link";
import CartBadge from "./CartBadge";

const LINKS = [
  { href: "/notes", label: "Notes" },
  { href: "/notes/current-affairs", label: "CA Compilations" },
  { href: "/notes/track", label: "Track order" },
];

export default function StoreSubnav() {
  return (
    <div className="border-b border-[var(--ca-navy)]/10 bg-[var(--ca-ivory,#f7f4ee)]">
      <div className="container-wide flex items-center justify-between gap-3 py-2.5">
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium text-[var(--ca-navy)]">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-[var(--ca-gold-dark,#9a7b2f)]">
              {l.label}
            </Link>
          ))}
        </nav>
        <CartBadge />
      </div>
    </div>
  );
}
