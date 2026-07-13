import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { DEFAULT_HERO } from "@/lib/homeDefaults";
import type { HeroConfig, HeroButtonStyle } from "@/lib/types";
import HeroBackdrop from "./HeroBackdrop";
import HeroStageV2 from "./HeroStageV2";
import HeroCardCluster from "./HeroCardCluster";

/**
 * Canonicalize an admin-uploaded portrait URL for next/image. The media proxy
 * lives on the apex `namanias.com`, which 308-redirects to `www` — rewriting it
 * up front skips a redirect hop for the image optimizer. Any other value
 * (Supabase URL, other host) is passed through untouched.
 */
function normalizePortraitUrl(url?: string | null): string | undefined {
  const u = url?.trim();
  if (!u) return undefined;
  return u.replace(/^https?:\/\/namanias\.com\//i, "https://www.namanias.com/");
}

const BTN_CLASS: Record<HeroButtonStyle, string> = {
  primary: "ca-btn ca-btn-gold",
  gold: "ca-btn ca-btn-gold",
  saffron: "ca-btn ca-btn-gold",
  secondary: "ca-btn ca-btn-glass",
};

/**
 * Home V2 hero — a server-rendered, LCP-safe cinematic hero. The headline, sub,
 * CTAs and stats are real text painted immediately from admin settings; the
 * ambient starfield + gold compass motif are pure decoration behind them. The
 * 3D layer (Phase C) mounts on top of this without owning any text.
 */
export default function HeroV2({ hero }: { hero?: HeroConfig }) {
  const h = hero || DEFAULT_HERO;
  const headline = (h.headline || DEFAULT_HERO.headline!).trim();
  const subheading = h.subheading?.trim() || DEFAULT_HERO.subheading!;
  const badge = h.badge?.trim();
  const stats = h.stats?.length ? h.stats : DEFAULT_HERO.stats!;
  const buttons = (h.buttons?.length ? h.buttons : DEFAULT_HERO.buttons!).filter(
    (b) => b.enabled && b.label?.trim() && b.href?.trim(),
  );
  // Reuse the same admin-editable source the classic hero uses — never hardcoded.
  const portrait = normalizePortraitUrl(h.portrait_url);
  const portraitAlt = h.portrait_alt?.trim() || "Naman Sir";

  // Highlight the mentor's name in gold without fragmenting the heading into
  // per-word spans (keeps a single, crawlable <h1> text node structure).
  const idx = headline.search(/naman/i);
  let pre = headline;
  let hi = "";
  let post = "";
  if (idx >= 0) {
    const rest = headline.slice(idx);
    const m = rest.match(/^naman(\s+sir)?/i);
    const hiText = m ? m[0] : "Naman";
    pre = headline.slice(0, idx);
    hi = hiText;
    post = headline.slice(idx + hiText.length);
  }

  return (
    <section className="hv2-space hv2-grain relative overflow-hidden">
      <HeroBackdrop />

      <div className="container-wide relative z-10 grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="max-w-2xl">
          {badge && (
            <span className="ca-badge ca-badge-gold mb-6 backdrop-blur">
              <Sparkles size={13} aria-hidden="true" /> {badge.replace(/^[^A-Za-z0-9₹]+/, "").trim() || badge}
            </span>
          )}

          <h1 className="font-heading text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-[4.25rem]">
            {pre}
            {hi && <span className="hv2-gold-text">{hi}</span>}
            {post}
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--ca-slate-300)]">{subheading}</p>

          {buttons.length > 0 && (
            <div className="mt-8 flex flex-wrap gap-3">
              {buttons.map((b, i) => (
                <Link key={i} href={b.href} className={`${BTN_CLASS[b.style || "primary"]} px-6 text-base`}>
                  {b.label}
                  {i === 0 && <ArrowRight size={17} aria-hidden="true" />}
                </Link>
              ))}
            </div>
          )}

          {stats.length > 0 && (
            <dl className="mt-12 grid max-w-lg grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
              {stats.map((st, i) => (
                <div key={i}>
                  <dt className="sr-only">{st.label}</dt>
                  <dd className="font-heading text-3xl font-extrabold text-white">
                    {st.value.toLocaleString("en-IN")}
                    <span className="text-[var(--ca-gold-bright)]">{st.suffix}</span>
                  </dd>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-[var(--ca-slate-400)]">{st.label}</p>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* Right: the cinematic focal point. When a portrait is uploaded in admin
            settings we frame it over the glowing Ashoka Chakra; otherwise we keep
            the animated glass "journey" card cluster as a graceful fallback. */}
        {portrait ? (
          <HeroStageV2 src={portrait} alt={portraitAlt} />
        ) : (
          <HeroCardCluster className="hidden lg:block" />
        )}
      </div>

      <div className="ca-divider" />
    </section>
  );
}
