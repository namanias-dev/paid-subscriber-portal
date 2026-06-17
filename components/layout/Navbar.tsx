import Logo from "@/components/ui/Logo";
import { ACADEMY } from "@/lib/config";

export default function Navbar() {
  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{
        background: "rgba(10,22,40,0.85)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <a href="#top" className="flex items-center gap-2">
          <Logo size={40} />
          <div className="leading-tight">
            <div className="font-heading text-lg text-text">{ACADEMY.shortName}</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted">
              Subscriber Portal
            </div>
          </div>
        </a>
        <a href="#login" className="text-sm font-medium text-gold-light hover:underline">
          Already a subscriber? Login →
        </a>
      </div>
    </header>
  );
}
