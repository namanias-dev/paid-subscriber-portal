# Naman IAS frontend design

There is no standalone design-system, style-guide, or tokens package. The live look is encoded in CSS variables + Tailwind + shared component classes.

Two palettes coexist:

- **Public / marketing (current brand):** navy + gold, glass, dark sticky nav. Prefix `.ca-*`.
- **App chrome (admin, portal forms, older surfaces):** electric blue `#0057FF` on white/gray. Classes `.btn`, `.card`, `.input`.

Public pages (nav, course cards, current-affairs, home) use navy/gold. Dashboard/admin still use blue tokens.

Stack: Next.js 14 App Router, React 18, Tailwind 3.4, `app/globals.css` (no shadcn `components.json`, no SCSS).

---

## 1. Colors

### Public brand (navy + gold)

| Token | Hex | Role |
| --- | --- | --- |
| `--ca-navy-900` | `#0A1A3F` | Hero / nav / dark bands |
| `--ca-navy-800` | `#0F2557` | Dark gradient end |
| `--ca-navy-600` | `#1E3A8A` | Mid navy, icon chips |
| `--navy` | `#0B1F4D` | Legacy navy (root) |
| `--ca-gold` | `#D4AF37` | Gold fill / underline |
| `--ca-gold-bright` | `#F2C94C` | Eyebrows, CTA, active underline |
| `--ca-gold-soft` | `#FCE9A8` | Soft gold wash |
| `--gold` / `--gold-soft` | `#C9A227` / `#F6ECC9` | Older gold tokens |

Nav bar fill: `rgba(10,26,63,0.86)` resting, `rgba(8,20,50,0.94)` scrolled. Borders `white/10`. Wordmark subline and “New” pill: `--ca-gold-bright` on `#1A1304`.

### App / form tokens (Tailwind + `:root`)

| Token | Hex | Role |
| --- | --- | --- |
| `--primary` / `primary` | `#0057FF` | Primary buttons, links, theme-color |
| `--primary-hover` | `#0046CC` | Button hover |
| `--primary-tint` | `#EAF1FF` | Tints, secondary hover |
| `--canvas` | `#FFFFFF` | Page background |
| `--surface` | `#F5F7FA` | Panels, ghost hover |
| `--surface2` | `#FBFCFE` | Alternate surface |
| `--ink` | `#1A1A1A` | Body / headings |
| `--ink2` | `#5A6472` | Secondary text, labels |
| `--muted` | `#8A93A2` | Placeholders, hints |
| `--line` | `#E5E9F0` | Default border |
| `--line-strong` | `#D5DBE6` | Hover border |
| `--success` | `#16A34A` | Success / green pills |
| `--warning` | `#F59E0B` | Warning |
| `--danger` | `#DC2626` | Error |
| `--saffron` / `--india` | `#FF9933` / `#138808` | India tricolor accents |
| `--grad` | `#0057FF → #3D8BFF` | Text/logo gradient |

CA slates: `#F8FAFC`, `#E2E8F0`, `#CBD5E1`, `#94A3B8`, `#334155`, `#1E293B`.

WhatsApp CTA: `#25D366`.

---

## 2. Typography

Loaded in `app/layout.tsx` via `next/font/google`:

- **Headings:** Sora 600/700/800 → `--font-sora` → Tailwind `font-heading`. Letter-spacing `-0.02em`.
- **Body:** Inter 400/500/600/700 → `--font-inter` → `font-body`. Default on `html/body`. Features `cv02–cv04`.

Viewport `themeColor`: `#0057FF`.

### Size hierarchy (typical)

| Use | Size / weight |
| --- | --- |
| Nav wordmark | 17px / `sm:text-lg`, Sora extrabold, white |
| Nav subline | 10px, uppercase, tracking `0.18em`, gold |
| Nav links | `text-sm` medium |
| Eyebrow `.ca-eyebrow` | `0.72rem`, bold, uppercase, tracking `0.2em`, gold |
| Hero title `.ca-hero-title` | Sora; white→gold clip; line-height `1.12` |
| Section headings | Sora h1–h4, ink |
| Rich body `.rich` | 16px / line-height `1.75` |
| Rich h2 | `1.5rem` |
| Buttons `.btn` | `text-sm` semibold |
| Buttons `.ca-btn` | `0.9rem` bold |
| Inputs | `15px` |
| Labels | `text-sm` medium, `--ink2` |
| Pills | `text-xs` semibold |
| Filter chips `.ca-filter` | `0.85rem` semibold |

---

## 3. Spacing + layout

| Token / class | Value |
| --- | --- |
| `.container-x` | `max-w-6xl` (1152px), `px-4` / `sm:px-6`, centered |
| `.container-wide` | `max-w-7xl` (1280px), same padding — used by nav |
| `.section` | `py-16` / `sm:py-24` |
| Nav inner | `py-3` rest, `py-2` scrolled |
| Card (modal) | `p-5` |
| Downloads card padding | `1.5px` gradient border then inner |
| Button pad `.btn` | `px-5`, vertical `0.6rem`, min-height **44px** |
| Button pad `.ca-btn` | `0.7rem 1.15rem`, min-height **46px** |
| Input | `px-3.5`, vertical `0.6rem`, min-height **44px** |
| Site shell | `min-h-dvh` column: nav / `main.flex-1` / footer |
| `--header-h` | runtime header height (access bars stick below nav) |

Major gaps: nav links `gap-0.5`; desktop CTAs `gap-2`; logo cluster `gap-2.5`; icon chips 46×46.

---

## 4. UI shape

| Element | Radius | Border | Shadow |
| --- | --- | --- | --- |
| Tailwind `rounded-xl` | 12px | | |
| Tailwind `rounded-2xl` | 20px | | |
| `.card` | 20px | `1px solid var(--line)` | `0 1px 3px / 0 8px 24px` rgba(16,24,40,0.06) |
| `.ca-card` / `.ca-glass` | 22px | slate-200 or white/12 | navy-tinted lift; glass inset highlight |
| `.ca-btn` | 14px | | gold glow on gold CTA |
| `.btn` / `.input` | 12px (`rounded-xl`) | line / primary | input focus ring `0 0 0 4px rgba(0,87,255,0.12)` |
| Pills / filters | full (`9999px`) | | |
| Nav profile | `rounded-full` | white/15 | |
| Mobile menu btn | `rounded-xl` | white/15 | |
| Course card | outer `rounded-2xl` gold-navy gradient 1px; inner `15px` | | deep navy + gold hover |
| Logo mark | 12px | | blue `0 6px 18px rgba(0,87,255,0.30)` |

Named shadows: `soft`, `soft-sm`, `soft-lg`, `focus`. Hover lift: cards `-3px` to `-4px`. Frost: white/80, blur 14px.

Focus: app blue ring; public `.ca-focus:focus-visible` gold `0 0 0 3px rgba(212,175,55,0.55)`.

---

## 5. Core component style

### Primary button

- **Public CTA:** `.ca-btn.ca-btn-gold` — gold gradient `#F2C94C → #D4AF37`, text `#1A1304`, hover lift + brightness. Nav “Book Free Demo”.
- **App:** `.btn.btn-primary` — solid `#0057FF`, white text, blue drop shadow, hover `#0046CC`.
- Also `.btn-gold` (older): `#D4AF37 → #F0D878`.

### Secondary button

- **Public:** `.ca-btn-glass` (white/6, white/16 border, blur) for Login; `.ca-btn-outline` white + slate border + navy-800 text on light pages.
- **App:** `.btn-secondary` white fill, primary text + 1px primary border, tint hover. `.btn-ghost` transparent → surface.

### Cards

- App `.card`: white, 20px, soft shadow.
- Public `.ca-card`: white, 22px, gold border on hover.
- Public `.ca-glass`: translucent on navy heroes.
- `CourseCard`: 16:9 navy cover, gold icon fallback, gradient frame.

### Inputs

`.input`: white, 12px radius, 44px min height, 15px type, `--line` border; focus primary border + 4px blue ring. Placeholder `--muted`. `.label` above, ink2.

### Navbar (`PublicNav`)

Sticky `z-50`, backdrop-blur-xl, navy translucent, gold underline on active/hover links. Desktop nav from `lg:`. Mobile: 44px hamburger, full-screen drawer. Logged-in: gold-gradient initials avatar + glass pill. Announcement ticker sits under header.

---

## 6. Responsive breakpoints

Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536.

Used most: **`sm`** (container padding, section py, modal centering) and **`lg`** (nav desktop vs drawer). Course covers: 100vw / 50vw / 33vw at 640 / 1024. Touch targets stay ≥44px.

`prefers-reduced-motion` globally kills animations in `globals.css`.

---

## 7. Key frontend files

| Path | Role |
| --- | --- |
| `app/globals.css` | All tokens, `.btn`/`.card`/`.input`, `.ca-*` brand layer |
| `tailwind.config.ts` | Tailwind color/font/radius/shadow map (blue/light set; navy/gold live in CSS) |
| `app/layout.tsx` | Sora + Inter, `themeColor` |
| `app/(site)/layout.tsx` | Public shell: nav, footer, WhatsApp |
| `components/public/PublicNav.tsx` | Sticky navy/gold nav |
| `components/public/CourseCard.tsx` | Public card pattern |
| `components/ui/Logo.tsx` | Fallback “N” mark (blue gradient) |
| `components/ui/Modal.tsx` | `.card` modal |
| `components/layout/StudentTopbar.tsx` | Logged-in student chrome (if needed as portal counterpart) |
| `components/public/PublicFooter.tsx` | Public footer (paired with site layout) |

Do not treat `design-reference/*.png` or `supabase/migrations/2026-site-brand.sql` as a frontend design system.
