/**
 * Public Notes catalogue HTML cache window.
 * Cart, checkout, order, and track stay force-dynamic.
 * Offer holds are NOT released during this render — see getPublicActiveOfferRead.
 */
export const NOTES_PUBLIC_REVALIDATE_SECONDS = 120;
