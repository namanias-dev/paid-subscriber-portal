/**
 * Home V2 hero fallback — the premium animated glass "journey" card cluster.
 * Used when no portrait is uploaded AND as the graceful fallback if the portrait
 * image fails to load, so the hero never shows a broken "?" placeholder. Pure
 * presentational markup (CSS float animation only, reduced-motion-safe via the
 * shared `.hv2-float` rules); safe to render from server or client components.
 */
export default function HeroCardCluster({ className = "" }: { className?: string }) {
  return (
    <div className={`relative mx-auto h-[420px] w-full max-w-md ${className}`} aria-hidden="true">
      <div className="ca-glass hv2-float absolute left-2 top-6 w-56 p-5">
        <p className="ca-eyebrow">Live class tonight</p>
        <p className="mt-1 font-heading text-lg font-bold text-white">Ethics — Case Studies</p>
        <p className="mt-0.5 text-sm text-[var(--ca-slate-400)]">8:00 PM · Live + Recording</p>
      </div>
      <div className="ca-glass hv2-float--slow absolute right-0 top-32 w-52 p-5">
        <p className="ca-eyebrow">Prelims → Interview</p>
        <p className="mt-1 font-heading text-lg font-bold text-white">One clear path</p>
      </div>
      <div className="ca-glass hv2-float absolute bottom-4 left-10 w-56 p-5" style={{ animationDelay: "1.2s" }}>
        <p className="ca-eyebrow">Answer writing</p>
        <p className="mt-1 font-heading text-lg font-bold text-white">Personal feedback</p>
      </div>
    </div>
  );
}
