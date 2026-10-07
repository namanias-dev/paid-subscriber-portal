import { MapPin, Phone } from "lucide-react";
import type { ReactNode } from "react";

export interface PickupLocationView {
  name: string;
  addressLines: string[];
  mapsUrl: string | null;
  phoneDisplay: string | null;
  phoneTel: string | null;
}

/**
 * Academy Pickup location. Renders trusted config (checkout) or an order's frozen
 * snapshot (confirmation, tracking, admin). Links are anchors, never form buttons, so
 * they cannot submit checkout. No embedded map.
 */
export default function PickupLocationCard({
  location,
  eyebrow = "Pickup location",
  note,
  children,
  className = "",
}: {
  location: PickupLocationView;
  eyebrow?: string;
  note?: string | null;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-3xl border border-[var(--ca-gold-dark)]/25 bg-[#fffdf8] p-4 sm:p-5 ${className}`} aria-label={eyebrow}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">{eyebrow}</p>
      <div className="mt-2 flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ca-navy)]/[0.05] text-[var(--ca-navy)]" aria-hidden>
          <MapPin className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="font-heading text-[17px] font-semibold leading-snug text-[var(--ca-navy)]">{location.name}</p>
          <address className="mt-1 not-italic text-sm leading-relaxed text-[var(--ca-navy)]/75">
            {location.addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        </div>
      </div>
      {(location.mapsUrl || location.phoneTel) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {location.mapsUrl && (
            <a
              href={location.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ca-focus inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--ca-navy)]/15 bg-white px-4 text-sm font-semibold text-[var(--ca-navy)]"
            >
              View on Google Maps <span aria-hidden>↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          {location.phoneTel && (
            <a
              href={`tel:${location.phoneTel}`}
              className="ca-focus inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--ca-navy)]/15 bg-white px-4 text-sm font-semibold text-[var(--ca-navy)]"
            >
              <Phone className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              Call academy
              {location.phoneDisplay && <span className="sr-only">{location.phoneDisplay}</span>}
            </a>
          )}
        </div>
      )}
      {note && <p className="mt-3 text-sm leading-relaxed text-[var(--ca-navy)]/70">{note}</p>}
      {children}
    </section>
  );
}

export function pickupViewFromSnapshot(snapshot: {
  name: string;
  address_lines: string[];
  maps_url?: string | null;
  phone?: string | null;
  phone_tel?: string | null;
} | null | undefined): PickupLocationView | null {
  if (!snapshot) return null;
  return {
    name: snapshot.name,
    addressLines: snapshot.address_lines,
    mapsUrl: snapshot.maps_url || null,
    phoneDisplay: snapshot.phone || null,
    phoneTel: snapshot.phone_tel || null,
  };
}
