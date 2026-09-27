"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import CartBadge from "./CartBadge";

const pill =
  "ca-focus inline-flex items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold text-[var(--ca-navy)] transition-colors focus-visible:!rounded-full active:translate-y-px motion-reduce:active:translate-y-0 sm:px-4 sm:text-sm";

export default function StoreSubnav() {
  const path = usePathname() || "";
  const onCatalogue = path === "/notes";

  return (
    <div className="sticky top-[var(--header-h,4rem)] z-20 border-b border-[var(--ca-navy)]/10 bg-[var(--ca-surface)]/95 backdrop-blur">
      <div className="container-wide flex items-center justify-between gap-3 py-1.5">
        <nav aria-label="Notes store" className="flex min-w-0 items-center gap-2">
          <Link
            href="/notes"
            aria-current={onCatalogue ? "page" : undefined}
            className={`${pill} h-10 border ${
              onCatalogue
                ? "border-[var(--ca-gold)]/80 bg-[#fbf8f2]"
                : "border-[var(--ca-navy)]/12 bg-white hover:border-[var(--ca-gold)]/55 hover:bg-[#fbf8f2]"
            }`}
          >
            All notes
          </Link>
          <span className="inline-flex h-10 shrink-0 rounded-full bg-gradient-to-r from-[var(--ca-navy)]/40 to-[var(--ca-gold-dark)]/75 p-px">
            <Link
              href="/notes/track"
              aria-current={path.startsWith("/notes/track") ? "page" : undefined}
              className={`${pill} h-full bg-white hover:bg-[#fbf8f2] active:bg-[#f4efe4]`}
            >
              Track order
            </Link>
          </span>
        </nav>
        <CartBadge />
      </div>
    </div>
  );
}
