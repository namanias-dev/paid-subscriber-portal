import Link from "next/link";
import Logo from "@/components/ui/Logo";
import { ACADEMY, SUPPORT } from "@/lib/config";

export default function PublicFooter() {
  const cols = [
    {
      title: "Explore",
      links: [
        { href: "/courses", label: "All Courses" },
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
            <span className="font-heading text-lg font-extrabold">{ACADEMY.shortName}</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-ink2">{ACADEMY.tagline}</p>
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
            <li>{ACADEMY.address}</li>
            <li>Phone: {SUPPORT.phone}</li>
            <li>Email: {SUPPORT.email}</li>
          </ul>
          <div className="mt-3 flex gap-3 text-sm">
            <a href={ACADEMY.instagram} target="_blank" rel="noopener noreferrer" className="hover:text-primary">Instagram</a>
            <a href={ACADEMY.youtube} target="_blank" rel="noopener noreferrer" className="hover:text-primary">YouTube</a>
            <a href={ACADEMY.telegram} target="_blank" rel="noopener noreferrer" className="hover:text-primary">Telegram</a>
          </div>
        </div>
      </div>
      <div className="border-t border-line py-4 text-center text-xs text-muted">
        © {new Date().getFullYear()} {ACADEMY.name}. All rights reserved.
      </div>
    </footer>
  );
}
