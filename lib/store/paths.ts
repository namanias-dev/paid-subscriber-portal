/**
 * Canonical Notes Store product URLs.
 * /notes/{slug} is the PDP. /notes/products/{slug} is a compatibility alias.
 */
export const NOTES_RESERVED_SLUGS = new Set([
  "cart",
  "checkout",
  "products",
  "order",
  "track",
  "faqs",
  "bundles",
]);

/** Old demo slugs → current canonical product slugs. */
export const NOTES_LEGACY_PRODUCT_SLUGS: Record<string, string> = {
  "test-polity-notes": "polity",
  "test-only-polity-notes": "polity",
  "test-economy-notes": "economy",
  "indian-polity-notes": "polity",
  "indian-economy-notes": "economy",
  "modern-history-notes": "modern-history",
};

export function notesProductPath(slug: string): string {
  return `/notes/${slug}`;
}

export function resolveNotesProductSlug(slug: string): string {
  return NOTES_LEGACY_PRODUCT_SLUGS[slug] || slug;
}

export function notesProductRedirect(fromSlug: string): string {
  return notesProductPath(resolveNotesProductSlug(fromSlug));
}

export function isNotesReservedSlug(slug: string): boolean {
  return NOTES_RESERVED_SLUGS.has(slug);
}
