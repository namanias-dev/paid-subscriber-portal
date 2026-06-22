"use client";

import Link from "next/link";

/** Sticky bottom CTA on mobile to drive monthly-PDF / lead conversion. */
export default function CaStickyCTA({
  label = "Get free monthly Current Affairs PDF",
  href = "#ca-lead",
}: {
  label?: string;
  href?: string;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 p-3 backdrop-blur lg:hidden">
      <Link href={href} className="btn btn-primary w-full text-sm">{label}</Link>
    </div>
  );
}
