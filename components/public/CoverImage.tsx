import Image from "next/image";
import { toPublicImageSrc } from "@/lib/publicMediaUrl";

/**
 * Responsive cover image with no layout shift (fixed aspect-ratio container).
 * Uses a separate mobile crop when provided, otherwise falls back to the main image.
 * Sources are rewritten to stable public `/media/…` (or CDN) — never presigned R2.
 */
export default function CoverImage({
  src,
  mobileSrc,
  alt,
  priority = true,
}: {
  src?: string | null;
  mobileSrc?: string | null;
  alt: string;
  priority?: boolean;
}) {
  const main = toPublicImageSrc(src || mobileSrc);
  if (!main) return null;
  const mob = toPublicImageSrc(mobileSrc || src) || main;

  return (
    <div className="relative mb-6 aspect-[16/9] w-full overflow-hidden rounded-2xl bg-surface2 sm:aspect-[2/1]">
      {/* Mobile */}
      <Image
        src={mob}
        alt={alt}
        fill
        priority={priority}
        sizes="100vw"
        className="object-cover sm:hidden"
      />
      {/* Desktop / tablet */}
      <Image
        src={main}
        alt={alt}
        fill
        priority={priority}
        sizes="(max-width: 1024px) 100vw, 66vw"
        className="hidden object-cover sm:block"
      />
    </div>
  );
}
