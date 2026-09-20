---
name: academy-design
description: >-
  Naman IAS Academy design system, gold-standard components, and UI quality bar.
  Use when building or restyling any public, portal, admin, or Notes Store UI;
  when matching navy/gold CA language; or when unsure which existing component to reuse.
---

# Academy design

## Quick rules

1. Read references below before inventing UI.
2. Reuse gold-standard files; compose rather than duplicate.
3. Tokens first — `app/globals.css` `:root` and `--ca-*` block.
4. Typography: `font-heading` (Sora) for titles; body Inter.
5. Layout: `container-wide` / `container-x`; public dark heroes use `ca-dark ca-grain`.
6. Focus: `ca-focus`. Motion: short, purposeful, `motion-reduce:` safe.

## Premium definition

**Is:** restraint, hierarchy, spacing, credibility, mobile polish, clear CTAs.  
**Is not:** glass everywhere, glow, purple SaaS, fake stats, badge piles, cards nested three deep, generic Shopify templates.

## Notes Store

Must feel like the same Academy product (CA + courses language), not a separate shop skin. Spec taste: navy, warm surfaces, subtle gold — see `docs/notes-store-spec.md` §1.

## References

- [DESIGN_SYSTEM.md](references/DESIGN_SYSTEM.md)
- [GOLD_STANDARD_COMPONENTS.md](references/GOLD_STANDARD_COMPONENTS.md)
- [PAGE_PATTERNS.md](references/PAGE_PATTERNS.md)
- [RESPONSIVE_PATTERNS.md](references/RESPONSIVE_PATTERNS.md)
- [ANTI_PATTERNS.md](references/ANTI_PATTERNS.md)
