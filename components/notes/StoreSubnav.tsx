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
                ? "border-[#d4af37]/75 bg-[#fbf8f2]"
                : "border-[#0a1a3f]/15 bg-white hover:border-[#d4af37]/65 hover:bg-[#fbf8f2]"
            }`}
          >
            All notes
          </Link>
          <span className="inline-flex h-10 shrink-0 rounded-full bg-[linear-gradient(90deg,rgba(10,26,63,0.4),rgba(154,123,47,0.78))] p-px transition-[background-image] duration-150 hover:bg-[linear-gradient(90deg,rgba(10,26,63,0.58),rgba(154,123,47,0.92))]">
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
