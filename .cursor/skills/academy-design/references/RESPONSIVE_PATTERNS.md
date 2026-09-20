# Responsive patterns

## Breakpoints (Tailwind defaults)

- Mobile-first: base → `sm` 640 → `md` 768 → `lg` 1024 → `xl` 1280
- Must verify Notes purchase flow at **375, 390, 430** CSS px

## Patterns that work here

- Fixed bottom CTA bars: pair with `pb-24`–`pb-28` on the page
- `min-h-11` / `min-h-12` tap targets
- Hide secondary actions in overflow menus rather than shrink text unreadably
- Tables: `overflow-x-auto` or card stacks on small screens
- Nav: desktop row + mobile drawer (`PublicNav`)

## Avoid

- Horizontal overflow from fixed widths / long unbroken SKUs (use `truncate` / `break-all` on monospace)
- Desktop-only hover as the only affordance
- Modals that don't account for virtual keyboard on mobile checkout
