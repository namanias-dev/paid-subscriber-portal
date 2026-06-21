import type { BrandConfig } from "./types";

/** URL for the "Get Directions" button — uses the admin link, else searches the address. */
export function directionsUrl(brand: BrandConfig): string {
  const url = brand.maps_url?.trim();
  if (url) return url;
  const q = encodeURIComponent(brand.address?.trim() || "Sector 17C Chandigarh");
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Embeddable map src for the iframe — uses the admin embed URL, else derives from address. */
export function mapEmbedUrl(brand: BrandConfig): string {
  const embed = brand.maps_embed_url?.trim();
  if (embed) return embed;
  const q = encodeURIComponent(brand.address?.trim() || "Sector 17C Chandigarh");
  return `https://www.google.com/maps?q=${q}&output=embed`;
}
