import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CaIconChip } from "./CaIcons";

export interface Crumb {
  label: string;
  href?: string;
}

/** Cohesive premium dark header band used across CA archive/taxonomy pages. */
export default function CaPageHeader({
  eyebrow,
  title,
  subtitle,
  crumbs = [],
  icon,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  icon?: LucideIcon;
}) {
  return (
    <header className="ca-dark ca-grain relative overflow-hidden">
      <div className="ca-orb" style={{ width: 280, height: 280, top: -120, right: -60, background: "rgba(212,175,55,0.18)" }} />
      <div className="container-wide relative py-12 sm:py-16">
        {crumbs.length > 0 && (
          <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ca-slate-400)]">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight size={13} aria-hidden="true" />}
                {c.href ? (
                  <Link href={c.href} className="ca-focus transition hover:text-[var(--ca-gold-bright)]">{c.label}</Link>
                ) : (
                  <span className="text-[var(--ca-slate-300)]">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-start gap-4">
          {icon && <CaIconChip icon={icon} />}
          <div>
            <p className="ca-eyebrow">{eyebrow}</p>
            <h1 className="mt-2 font-heading text-3xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-4xl">{title}</h1>
            {subtitle && <p className="mt-3 max-w-2xl text-[var(--ca-slate-300)]">{subtitle}</p>}
          </div>
        </div>
      </div>
    </header>
  );
}
