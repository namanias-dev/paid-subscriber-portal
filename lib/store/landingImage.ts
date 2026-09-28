/**
 * Which image the Notes Store landing notebook shows.
 * A dedicated 4:5 thumbnail fills the notebook. A 4:3 product cover stays
 * contained so it is not cropped. Neither image means the navy booklet.
 */
export function landingNotebookImage(product: {
  store_thumbnail_url?: string | null;
  cover_url?: string | null;
}): { url: string | null; fit: "cover" | "contain" } {
  if (product.store_thumbnail_url) return { url: product.store_thumbnail_url, fit: "cover" };
  if (product.cover_url) return { url: product.cover_url, fit: "contain" };
  return { url: null, fit: "contain" };
}
