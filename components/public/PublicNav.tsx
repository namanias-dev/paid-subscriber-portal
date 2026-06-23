"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Menu, X, ArrowRight, LogOut, LayoutDashboard, UserCircle,
  BookOpen, Newspaper, ListChecks, Trophy, Video, Gift, Info, Phone, Sparkles,
  type LucideIcon,
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import { ACADEMY } from "@/lib/config";
import { DEFAULT_NAV_TABS, type NavTab } from "@/lib/navConfig";

async function doLogout() {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
  window.location.href = "/";
}

async function doPortalLogout() {
  try { await fetch("/api/portal/logout", { method: "POST" }); } catch { /* ignore */ }
  window.location.href = "/";
}

/** Lucide icon per route for the premium nav (desktop hover + mobile drawer rows). */
const NAV_ICONS: Record<string, LucideIcon> = {
  "/courses": BookOpen,
  "/current-affairs": Newspaper,
  "/quizzes": ListChecks,
  "/results": Trophy,
  "/webinars": Video,
  "/free-resources": Gift,
  "/about": Info,
  "/contact": Phone,
};
const iconFor = (href: string): LucideIcon => NAV_ICONS[href] || Sparkles;

export default function PublicNav({
  logoUrl,
  logoAlt,
  logoHeight = 48,
  showWordmark = true,
  wordmark = "Naman Sharma",
  wordmarkSub = "IAS Academy",
  isLoggedIn = false,
  portalLoggedIn = false,
  links = DEFAULT_NAV_TABS,
}: {
  logoUrl?: string | null;
  logoAlt?: string | null;
  logoHeight?: number;
  showWordmark?: boolean;
  wordmark?: string;
  wordmarkSub?: string;
  isLoggedIn?: boolean;
  portalLoggedIn?: boolean;
  links?: NavTab[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const LINKS = links;
  const hasLogo = !!logoUrl?.trim();
  const h = Math.min(96, Math.max(28, Number(logoHeight) || 48));

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // Condense-on-scroll + subtle shadow.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll + Esc to close while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);

  // Close the drawer on navigation.
  useEffect(() => { setOpen(false); }, [pathname]);

  const LogoMark = (
    <Link href="/" className="ca-focus flex items-center gap-2.5" aria-label={ACADEMY.name}>
      {hasLogo ? (
        <Image
          src={logoUrl!.trim()}
          alt={logoAlt || ACADEMY.name}
          width={Math.round(h * 4)}
          height={h}
          priority
          className="w-auto object-contain"
          style={{ height: h, maxWidth: 230 }}
        />
      ) : (
        <Logo size={h} />
      )}
      {showWordmark && (wordmark?.trim() || wordmarkSub?.trim()) && (
        <div className="leading-tight">
          {wordmark?.trim() && <div className="font-heading text-[17px] font-extrabold text-white sm:text-lg">{wordmark}</div>}
          {wordmarkSub?.trim() && <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--ca-gold-bright)]">{wordmarkSub}</div>}
        </div>
      )}
    </Link>
  );

  return (
    <>
    <header
      className={`sticky top-0 z-50 border-b backdrop-blur-xl transition-all duration-300 motion-reduce:transition-none ${
        scrolled
          ? "border-white/10 bg-[rgba(8,20,50,0.94)] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.55)]"
          : "border-white/10 bg-[rgba(10,26,63,0.86)]"
      }`}
    >
      <div className={`container-wide flex items-center justify-between transition-all duration-300 motion-reduce:transition-none ${scrolled ? "py-2" : "py-3"}`}>
        {LogoMark}

        {/* Desktop links */}
        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          {LINKS.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`ca-focus group relative rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 ${active ? "text-white" : "text-white/70 hover:text-white"}`}
              >
                {l.label}
                <span
                  className={`pointer-events-none absolute inset-x-3 -bottom-px h-0.5 origin-left rounded-full bg-[var(--ca-gold-bright)] transition-all duration-200 motion-reduce:transition-none ${
                    active ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-100"
                  }`}
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </nav>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-2 lg:flex">
          {isLoggedIn ? (
            <>
              <Link href="/dashboard" className="ca-btn ca-btn-gold ca-focus px-4 text-sm"><LayoutDashboard size={16} /> Dashboard</Link>
              <button onClick={doLogout} className="ca-btn ca-btn-glass ca-focus px-4 text-sm"><LogOut size={15} /> Logout</button>
            </>
          ) : portalLoggedIn ? (
            <>
              <Link href="/portal" className="ca-btn ca-btn-gold ca-focus px-4 text-sm"><UserCircle size={16} /> My Portal</Link>
              <button onClick={doPortalLogout} className="ca-btn ca-btn-glass ca-focus px-4 text-sm"><LogOut size={15} /> Logout</button>
            </>
          ) : (
            <>
              <Link href="/login" className="ca-btn ca-btn-glass ca-focus px-4 text-sm">Login</Link>
              <Link href="/demo" className="ca-btn ca-btn-gold ca-focus px-4 text-sm">Book Free Demo <ArrowRight size={15} /></Link>
            </>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-drawer"
          onClick={() => setOpen((o) => !o)}
          className="ca-focus relative grid h-11 w-11 place-items-center rounded-xl border border-white/15 bg-white/5 text-white transition hover:bg-white/10 lg:hidden"
        >
          <Menu size={22} className={`absolute transition-all duration-200 motion-reduce:transition-none ${open ? "rotate-90 opacity-0" : "rotate-0 opacity-100"}`} aria-hidden="true" />
          <X size={22} className={`absolute transition-all duration-200 motion-reduce:transition-none ${open ? "rotate-0 opacity-100" : "-rotate-90 opacity-0"}`} aria-hidden="true" />
        </button>
      </div>
    </header>

      {/* Mobile drawer — rendered OUTSIDE <header> because the header's backdrop-filter
          would otherwise become the containing block for this fixed element (shrinking
          inset-0 to the header bar and hiding the menu). Outer is fixed inset-0 +
          overflow-hidden so the off-canvas panel is clipped and never adds page width. */}
      <div
        id="mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        className={`fixed inset-0 z-[60] overflow-hidden lg:hidden ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      >
        {/* Backdrop */}
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/55 backdrop-blur-sm transition-opacity duration-300 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
          aria-hidden="true"
        />
        {/* Panel */}
        <div
          className={`ca-grain absolute right-0 top-0 flex h-full w-[86%] max-w-sm flex-col bg-gradient-to-b from-[var(--ca-navy-900)] to-[var(--ca-navy-800)] shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? "translate-x-0" : "translate-x-full"}`}
        >
          <div className="ca-orb" style={{ width: 240, height: 240, top: -120, right: -60, background: "rgba(212,175,55,0.18)" }} />

          <div className="relative flex items-center justify-between border-b border-white/10 px-5 py-4">
            {LogoMark}
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="ca-focus grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/5 text-white transition hover:bg-white/10"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <nav className="relative flex-1 overflow-y-auto px-3 py-4" aria-label="Mobile">
            <ul className="space-y-1">
              {LINKS.map((l) => {
                const active = isActive(l.href);
                const Icon = iconFor(l.href);
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`ca-focus relative flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition active:scale-[0.99] ${
                        active ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {active && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-[var(--ca-gold-bright)]" aria-hidden="true" />}
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${active ? "bg-[rgba(212,175,55,0.18)] text-[var(--ca-gold-bright)]" : "bg-white/5 text-white/70"}`}>
                        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      {l.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="relative space-y-2.5 border-t border-white/10 px-5 py-4">
            {isLoggedIn ? (
              <>
                <Link href="/dashboard" onClick={() => setOpen(false)} className="ca-btn ca-btn-gold ca-focus w-full justify-center"><LayoutDashboard size={17} /> Dashboard</Link>
                <button onClick={() => { setOpen(false); doLogout(); }} className="ca-btn ca-btn-glass ca-focus w-full justify-center"><LogOut size={16} /> Logout</button>
              </>
            ) : portalLoggedIn ? (
              <>
                <Link href="/portal" onClick={() => setOpen(false)} className="ca-btn ca-btn-gold ca-focus w-full justify-center"><UserCircle size={17} /> My Portal</Link>
                <button onClick={() => { setOpen(false); doPortalLogout(); }} className="ca-btn ca-btn-glass ca-focus w-full justify-center"><LogOut size={16} /> Logout</button>
              </>
            ) : (
              <>
                <Link href="/demo" onClick={() => setOpen(false)} className="ca-btn ca-btn-gold ca-focus w-full justify-center">Book Free Demo <ArrowRight size={16} /></Link>
                <Link href="/login" onClick={() => setOpen(false)} className="ca-btn ca-btn-glass ca-focus w-full justify-center">Login</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
