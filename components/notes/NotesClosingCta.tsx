import Link from "next/link";

export default function NotesClosingCta() {
  return (
    <section className="ca-dark ca-grain relative overflow-hidden">
      <div className="ca-orb" style={{ width: 280, height: 280, bottom: -80, left: -40, background: "rgba(212,175,55,0.16)" }} />
      <div className="container-wide relative py-16 text-center sm:py-20">
        <p className="ca-eyebrow">Physical notes by Naman Sir</p>
        <h2 className="ca-hero-title mx-auto mt-3 max-w-2xl font-heading text-3xl font-extrabold sm:text-4xl">
          Your UPSC preparation deserves better notes
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-sm text-white/65">
          Handwritten classroom notes, printed as hard copies, packed in Chandigarh, delivered across India.
        </p>
        <Link href="#catalogue" className="ca-btn ca-btn-gold mt-8 rounded-full px-7">
          Explore Notes
        </Link>
      </div>
    </section>
  );
}
