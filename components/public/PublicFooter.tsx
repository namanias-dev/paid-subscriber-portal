import Link from "next/link";
import Logo from "@/components/ui/Logo";
import { DEFAULT_BRAND } from "@/lib/homeDefaults";
import { whatsappLink } from "@/lib/phone";
import { directionsUrl } from "@/lib/maps";
import type { BrandConfig } from "@/lib/types";

export default function PublicFooter({ brand }: { brand?: BrandConfig }) {
  const b = { ...DEFAULT_BRAND, ...(brand || {}) };
  const wa = whatsappLink(b.whatsapp || b.support_phone);
  const cols = [
    {
      title: "Explore",
      links: [
        { href: "/courses", label: "All Courses" },
        { href: "/current-affairs", label: "Current Affairs" },
        { href: "/quizzes", label: "Quizzes & Tests" },
        { href: "/results", label: "Results" },
        { href: "/webinars", label: "Webinars" },
        { href: "/free-resources", label: "Free Resources" },
      ],
    },
    {
      title: "Academy",
      links: [
        { href: "/about", label: "About Naman Sir" },
        { href: "/demo", label: "Book Free Demo" },
        { href: "/contact", label: "Contact" },
        { href: "/login", label: "Student Login" },
      ],
    },
  ];

  return (
    <footer className="mt-10 border-t border-line bg-surface2">
      <div className="container-wide grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Logo size={36} />
            <span className="font-heading text-lg font-extrabold">{b.short_name}</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-ink2">{b.tagline}</p>
          <div className="mt-4 flex gap-2 text-sm">
            <span className="pill pill-saffron">🇮🇳 Chandigarh</span>
          </div>
        </div>

        {cols.map((c) => (
          <div key={c.title}>
            <p className="mb-3 text-sm font-semibold text-ink">{c.title}</p>
            <ul className="space-y-2 text-sm text-ink2">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="hover:text-primary">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <p className="mb-3 text-sm font-semibold text-ink">Contact</p>
          <ul className="space-y-2 text-sm text-ink2">
            <li>{b.address}</li>
            <li>Phone: <a href={`tel:${b.support_phone}`} className="hover:text-primary">{b.support_phone}</a></li>
            {wa && <li>WhatsApp: <a href={wa} target="_blank" rel="noopener noreferrer" className="hover:text-primary">{b.whatsapp || b.support_phone}</a></li>}
            <li>Email: <a href={`mailto:${b.support_email}`} className="hover:text-primary">{b.support_email}</a></li>
          </ul>
          <a href={directionsUrl(b)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary mt-3 text-sm">📍 Get Directions</a>
          <div className="mt-3 flex gap-3 text-sm">
            {b.instagram && <a href={b.instagram} target="_blank" rel="noopener noreferrer" className="hover:text-primary">Instagram</a>}
            {b.youtube && <a href={b.youtube} target="_blank" rel="noopener noreferrer" className="hover:text-primary">YouTube</a>}
            {b.telegram && <a href={b.telegram} target="_blank" rel="noopener noreferrer" className="hover:text-primary">Telegram</a>}
          </div>
        </div>
      </div>
      <div className="border-t border-line py-4 text-center text-xs text-muted">
        © {new Date().getFullYear()} {b.name}. All rights reserved.
      </div>
    </footer>
  );
}
