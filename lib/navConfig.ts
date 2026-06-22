import type { NavConfig } from "./types";

export interface NavTab {
  href: string;
  label: string;
}

/** Canonical public navbar tabs — single source of truth (admin can hide/reorder). */
export const DEFAULT_NAV_TABS: NavTab[] = [
  { href: "/courses", label: "Courses" },
  { href: "/current-affairs", label: "Current Affairs" },
  { href: "/quizzes", label: "Quizzes" },
  { href: "/results", label: "Results" },
  { href: "/webinars", label: "Webinars" },
  { href: "/free-resources", label: "Free Resources" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

/**
 * Resolve the visible, ordered nav tabs from admin settings.
 * Backward-compatible: any tab without an override defaults to visible, and an
 * unknown/empty config shows all default tabs.
 */
export function resolveNavTabs(nav: NavConfig | undefined | null): NavTab[] {
  const ov = nav?.overrides || {};
  return DEFAULT_NAV_TABS
    .map((t, i) => ({ tab: t, visible: ov[t.href]?.visible !== false, order: ov[t.href]?.order ?? i }))
    .filter((x) => x.visible)
    .sort((a, b) => a.order - b.order)
    .map((x) => x.tab);
}
