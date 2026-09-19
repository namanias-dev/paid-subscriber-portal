# Design system

Source of truth: `app/globals.css`, `tailwind.config.ts`.

## Core light tokens (`:root`)

| Token | Value | Use |
|-------|-------|-----|
| `--canvas` | `#ffffff` | Page background |
| `--surface` / `--surface2` | `#f5f7fa` / `#fbfcfe` | Panels |
| `--ink` / `--ink2` / `--muted` | `#1a1a1a` / `#5a6472` / `#8a93a2` | Text |
| `--primary` | `#0057ff` | Academy primary actions (portal/admin) |
| `--navy` / `--gold` | `#0b1f4d` / `#c9a227` | Legacy brand aliases |
| `--line` | `#e5e9f0` | Borders |
| `--shadow-soft` | soft elevation | Cards |

Tailwind mirrors: `canvas`, `surface`, `ink`, `primary`, `line`, `font-heading`, `font-body`, `shadow-soft`, radii `xl`/`2xl`.

## Current Affairs / premium public (`--ca-*`)

| Token | Value |
|-------|-------|
| `--ca-navy-900` | `#0a1a3f` |
| `--ca-navy-800` | `#0f2557` |
| `--ca-navy-600` | `#1e3a8a` |
| `--ca-navy` | alias → navy-900 (storefront) |
| `--ca-gold` / `--ca-gold-bright` / `--ca-gold-soft` | `#d4af37` / `#f2c94c` / `#fce9a8` |
| `--ca-gold-dark` | `#9a7b2f` (eyebrows, savings) |
| `--ca-slate-50` … `--ca-slate-800` | Neutrals |
| `--ca-slate-100` | `#eef1f6` (media placeholders) |
| `--ca-surface` | warm page wash for Notes (`#f7f5f1`) |

## Utility classes

- `.ca-dark` + `.ca-grain` + `.ca-orb` — dark hero bands
- `.ca-eyebrow` — gold uppercase label
- `.ca-hero-title` — large white heading on dark
- `.ca-focus` — gold focus ring
- `.ca-filter` / `.ca-filter--active` — chip filters
- `.container-wide` — `max-w-7xl` padded
- `.container-x` — `max-w-6xl`

## Typography scale (practical)

- Hero: `text-3xl`–`text-5xl` `font-heading` `font-extrabold` `tracking-tight`
- Section: `text-2xl`–`text-3xl` `font-bold`
- Card title: `text-base`–`text-lg` `font-semibold`
- Meta/eyebrow: `text-[11px]`–`text-xs` uppercase `tracking-[0.14em]`
- Body: `text-sm` leading-relaxed at ~65% ink opacity on navy

## Buttons

- Primary dark: filled `--ca-navy-900`, white text, `min-h-12`, `rounded-full` on public marketing
- Gold CTA on dark heroes: `--ca-gold` fill, navy text
- Secondary: border `navy/20`, white fill
- Admin: denser, often `rounded` + slate-900 (admin shell), not marketing pills
