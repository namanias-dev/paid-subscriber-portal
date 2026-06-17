import Logo from "@/components/ui/Logo";
import { ACADEMY } from "@/lib/config";

export default function Footer() {
  return (
    <footer className="border-t" style={{ borderColor: "var(--border)" }}>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Logo size={36} />
              <span className="font-heading text-lg text-text">{ACADEMY.name}</span>
            </div>
            <p className="mt-2 max-w-xs text-sm text-muted">{ACADEMY.tagline}</p>
          </div>

          <div className="text-sm text-muted">
            <p className="mb-1 font-semibold text-text">Contact</p>
            <p>{ACADEMY.address}</p>
            <p>Phone: {ACADEMY.phone}</p>
            <div className="mt-2 flex gap-3">
              <a href={ACADEMY.instagram} target="_blank" rel="noopener noreferrer" className="hover:text-gold-light">
                Instagram
              </a>
              <a href={ACADEMY.youtube} target="_blank" rel="noopener noreferrer" className="hover:text-gold-light">
                YouTube
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t pt-4 text-center text-xs text-muted" style={{ borderColor: "var(--border)" }}>
          Powered by {ACADEMY.name}
        </div>
      </div>
    </footer>
  );
}
