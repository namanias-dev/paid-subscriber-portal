import Image from "next/image";
import type { Topper } from "@/lib/types";

function initials(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "★";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

/**
 * Premium topper card — shared by the Results page and the homepage showcase
 * (single source of truth). Falls back to a clean initials avatar when no photo
 * is uploaded, so older entries never show a broken image.
 */
export default function TopperCard({ topper }: { topper: Topper }) {
  const { name, rank, exam, image_url } = topper;
  const label = name?.trim() || rank;

  return (
    <div className="card card-hover flex h-full flex-col items-center rounded-2xl p-6 text-center">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full ring-4 ring-primary/15">
        {image_url ? (
          <Image src={image_url} alt={label} fill sizes="96px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 to-primary/40 font-heading text-2xl font-extrabold text-primary">
            {initials(label)}
          </div>
        )}
      </div>
      <div className="mt-4 font-heading text-xl font-extrabold text-primary">🏅 {rank}</div>
      {name?.trim() && <div className="mt-1 font-semibold text-ink">{name}</div>}
      {exam?.trim() && <div className="mt-0.5 text-sm text-muted">{exam}</div>}
    </div>
  );
}
