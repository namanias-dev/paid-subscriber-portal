"use client";

import Link from "next/link";
import { Download } from "lucide-react";

/** Sticky bottom CTA on mobile to drive monthly-PDF / lead conversion. */
export default function CaStickyCTA({
  label = "Get free monthly Current Affairs PDF",
  href = "#ca-lead",
}: {
  label?: string;
  href?: string;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgba(255,255,255,0.1)] bg-[rgba(10,26,63,0.92)] p-3 backdrop-blur-md lg:hidden">
      <Link href={href} className="ca-btn ca-btn-gold ca-focus w-full">
        <Download size={18} strokeWidth={2} /> {label}
      </Link>
    </div>
  );
}
