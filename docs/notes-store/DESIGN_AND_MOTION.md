# Notes Store — design and motion

Reference Academy design intelligence — **do not fork a second system:**

- `.cursor/skills/academy-design/SKILL.md`
- `references/DESIGN_SYSTEM.md`
- `references/GOLD_STANDARD_COMPONENTS.md`
- `references/PAGE_PATTERNS.md`
- `references/RESPONSIVE_PATTERNS.md`
- `references/ANTI_PATTERNS.md`

## Tokens

Navy / gold / ivory via CSS variables in `app/globals.css` (`.ca-*`, `--ca-navy`, `--ca-gold`). Notes UI should use these aliases — never arbitrary purple SaaS palettes.

## Gold-standard reuse map

| Need | Prefer | Notes Store consumer |
|------|--------|----------------------|
| Product card language | `CourseCard.tsx` | `components/notes/ProductCard.tsx` |
| Sticky CTA | `StickyMobileCTA` / `CaStickyCTA` | PDP / cart patterns |
| Nav hydrate | `PublicNav.tsx` | Notes link via `/api/notes/status` only |
| Forms | `LeadForm` / enroll checkout | `CheckoutForm.tsx` |
| Admin chrome | `components/admin/ui.tsx` | ProductAdmin / OrderQueue |

## Motion

Purposeful transitions only; respect `prefers-reduced-motion`. Do not add glow/glassmorphism for “premium.”

## Content / trust rules

- No fake reviews, fake scarcity, unsupported topper claims.  
- Reviews table/flag exist but must stay off until verified buyers.  
- TEST SKUs must stay clearly labelled.

## Landing hero

`/notes` uses a light ivory cinematic hero. The spiral notebook is a recovered-alpha product cutout in `public/notes/hero-notebook*.webp|png`, not a CSS booklet stack. Atmosphere, layered shadows and restrained Motion parallax are CSS/Framer only — no extra 3D stack. Shop by Subject stays the buy surface; Student Voices after it is demand, not a second catalogue.

## Design debt

- Some admin tables still utilitarian.  
- Test SKU may lack photography.  
- Bundle merchandising incomplete vs full commerce ambition.
