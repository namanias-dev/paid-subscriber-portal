import Link from "next/link";
import WhatsAppButton from "./WhatsAppButton";
import type { WhatsAppConfig } from "@/lib/types";

/**
 * Fixed bottom CTA bar shown on mobile only (lg:hidden). Keeps the primary
 * Pay/Enroll action and WhatsApp always reachable while scrolling.
 */
export default function StickyMobileCTA({
  priceLabel,
  ctaLabel,
  ctaHref,
  whatsapp,
}: {
  priceLabel: string;
  ctaLabel: string;
  ctaHref: string;
  whatsapp?: WhatsAppConfig | null;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          <p className="text-[11px] leading-none text-muted">Price</p>
          <p className="font-heading text-lg font-bold leading-tight">{priceLabel}</p>
        </div>
        <Link href={ctaHref} className="btn btn-primary flex-1">{ctaLabel}</Link>
        <WhatsAppButton config={whatsapp} className="px-3" />
      </div>
    </div>
  );
}
