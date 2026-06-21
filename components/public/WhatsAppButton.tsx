import { whatsappLink } from "@/lib/phone";
import type { WhatsAppConfig } from "@/lib/types";

/**
 * Prominent WhatsApp CTA. Renders only when admin enabled the CTA and a valid
 * number exists. Number is normalized to wa.me/91… via lib/phone.
 */
export default function WhatsAppButton({
  config,
  className = "",
  forceShow = false,
}: {
  config?: WhatsAppConfig | null;
  className?: string;
  forceShow?: boolean;
}) {
  if (!config) return null;
  if (!config.show_cta && !forceShow) return null;
  const href = whatsappLink(config.whatsapp || config.phone, config.prefill_message);
  if (!href) return null;
  const label = config.cta_text?.trim() || "WhatsApp Now";
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`btn btn-whatsapp ${className}`}>
      <span aria-hidden>💬</span> {label}
    </a>
  );
}
