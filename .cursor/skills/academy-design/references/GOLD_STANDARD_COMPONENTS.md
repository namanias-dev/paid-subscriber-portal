# Gold-standard components

Inspect these before creating new UI. Prefer composition over copies.

## Page shell / heroes

| Role | Path |
|------|------|
| Best public dark header | `components/public/ca/CaPageHeader.tsx` |
| Best marketing home (v2) | `components/public/home-v2/HomeV2.tsx`, `HeroV2.tsx` |
| CA design utilities | `app/globals.css` (`.ca-dark` block ~L458+) |
| Site chrome | `app/(site)/layout.tsx` + `components/public/PublicNav.tsx` + `PublicFooter.tsx` |

## Cards

| Role | Path |
|------|------|
| Best product-style card | `components/public/CourseCard.tsx` |
| CA article card | `components/public/ca/CaArticleCard.tsx` |
| Resource card | `components/public/resources/ResourceCard.tsx` |
| Webinar card | `components/public/WebinarCard.tsx` |
| Notes ProductCard (upgrade toward CourseCard) | `components/notes/ProductCard.tsx` |

## Forms / checkout

| Role | Path |
|------|------|
| Public lead form | `components/public/LeadForm.tsx` |
| Course enroll / pay | `components/public/EnrollClient.tsx`, `CheckoutClient.tsx` |
| Notes checkout | `components/notes/CheckoutForm.tsx` |
| Careers application | `components/public/careers/ApplicationForm.tsx` |

## Navigation

| Role | Path |
|------|------|
| Public nav (auth hydrate pattern) | `components/public/PublicNav.tsx` |
| Nav tab source | `lib/navConfig.ts` |
| Sticky mobile CTA | `components/public/StickyMobileCTA.tsx`, `components/public/ca/CaStickyCTA.tsx` |
| Notes subnav | `components/notes/StoreSubnav.tsx` |

## Admin

| Role | Path |
|------|------|
| Page header / KPI | `components/admin/ui.tsx` |
| Admin nav groups | `components/admin/adminNav.ts` |

## Empty / loading / trust

| Role | Path |
|------|------|
| Webinar not found | `components/public/WebinarNotFound.tsx` |
| Trust strip | `components/public/TrustStrip.tsx` |
| Payment caution | `components/public/PaymentCautionModal.tsx` |

## Do not treat as gold

Older home cinematic experiments when home-v2 is live; sparse Notes admin tables without address context; any screen using undefined CSS variables or flat grey Shopify-like product grids without Academy navy/gold language.
