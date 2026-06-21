import type { ContactLink } from "@/lib/types";
import { whatsappLink, telLink } from "@/lib/phone";

function hrefFor(link: ContactLink): string {
  const v = (link.value || "").trim();
  switch (link.type) {
    case "whatsapp":
      // Normalize Indian mobiles to wa.me/91… (fixes the +84 country-code bug);
      // fall back to a digits-only link for non-Indian / already-full numbers.
      return whatsappLink(v) || `https://wa.me/${v.replace(/\D/g, "")}`;
    case "phone":
      return telLink(v) || `tel:${v.replace(/[^\d+]/g, "")}`;
    case "email":
      return `mailto:${v}`;
    default:
      return v.startsWith("http") ? v : `https://${v}`;
  }
}

const ICON: Record<ContactLink["type"], string> = {
  whatsapp: "💬",
  phone: "📞",
  email: "✉️",
  telegram: "✈️",
  website: "🔗",
};

const DEFAULT_LABEL: Record<ContactLink["type"], string> = {
  whatsapp: "Chat on WhatsApp",
  phone: "Call us",
  email: "Email us",
  telegram: "Join on Telegram",
  website: "Visit website",
};

export default function ContactButtons({ links }: { links?: ContactLink[] | null }) {
  const items = (links || []).filter((l) => l.value?.trim());
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((l, i) => (
        <a
          key={i}
          href={hrefFor(l)}
          target="_blank"
          rel="noopener noreferrer"
          className={`btn text-sm ${l.type === "whatsapp" ? "btn-primary" : "btn-secondary"}`}
          style={l.type === "whatsapp" ? { background: "#25D366", borderColor: "#25D366" } : undefined}
        >
          <span aria-hidden>{ICON[l.type]}</span> {l.label?.trim() || DEFAULT_LABEL[l.type]}
        </a>
      ))}
    </div>
  );
}
