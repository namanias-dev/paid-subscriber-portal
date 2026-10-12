import type { NotesCurriculum } from "@/lib/store/notesCurriculum";

export default function NotesSubjectStory({ story }: { story: NotesCurriculum }) {
  return (
    <div className="ns-pdp-story">
      <section>
        <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Why this subject matters</p>
        <h2 className="mt-2 font-heading text-xl font-bold text-[var(--ca-navy)] sm:text-2xl">
          {story.positioningTitle || "Written for the paper, not the bookshelf"}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ca-navy)]/68">{story.why}</p>
      </section>

      {story.whyPoints && story.whyPoints.length > 0 ? (
        <section className="mt-10">
          <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Why these notes</p>
          <h2 className="mt-2 font-heading text-xl font-bold text-[var(--ca-navy)] sm:text-2xl">
            {story.whyTitle || "Why Naman Sir’s notes"}
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {story.whyPoints.map((point) => (
              <article key={point.title} className="rounded-2xl bg-white p-4 ns-elev-1">
                <h3 className="font-heading text-base font-bold text-[var(--ca-navy)]">{point.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--ca-navy)]/65">{point.body}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {(story.prelimsItems?.length || story.mainsItems?.length) ? (
        <section className="mt-10">
          <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Prelims + Mains</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {story.prelimsItems?.length ? (
              <article className="rounded-3xl bg-white p-5 ns-elev-1">
                <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">
                  {story.prelimsTitle || "For Prelims"}
                </h2>
                {story.prelimsIntro ? (
                  <p className="mt-2 text-sm leading-relaxed text-[var(--ca-navy)]/62">{story.prelimsIntro}</p>
                ) : null}
                <ul className="mt-4 space-y-2 text-sm text-[var(--ca-navy)]/70">
                  {story.prelimsItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ) : null}
            {story.mainsItems?.length ? (
              <article className="rounded-3xl bg-white p-5 ns-elev-1">
                <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">
                  {story.mainsTitle || "For Mains"}
                </h2>
                {story.mainsIntro ? (
                  <p className="mt-2 text-sm leading-relaxed text-[var(--ca-navy)]/62">{story.mainsIntro}</p>
                ) : null}
                <ul className="mt-4 space-y-2 text-sm text-[var(--ca-navy)]/70">
                  {story.mainsItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Coverage</p>
        <h2 className="mt-2 font-heading text-xl font-bold text-[var(--ca-navy)] sm:text-2xl">
          {story.coverageTitle || "What these notes cover"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ca-navy)]/55">
          UPSC-oriented themes — not a copied textbook table of contents.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {story.coverage.map((group) => (
            <details key={group.title} className="ns-pdp-topic">
              <summary>{group.title}</summary>
              <ul>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
        {story.referenceNote && <p className="mt-4 text-xs leading-relaxed text-[var(--ca-navy)]/48">{story.referenceNote}</p>}
      </section>

      <section className="mt-10">
        <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Static + current</p>
        <h2 className="mt-2 font-heading text-xl font-bold text-[var(--ca-navy)] sm:text-2xl">How the notes stay current</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ca-navy)]/68">{story.staticCurrentIntro}</p>
        <div className="mt-5 grid gap-2">
          {story.staticCurrent.map((row) => (
            <div key={row.topic} className="ns-pdp-linkrow">
              <p className="font-heading text-sm font-bold text-[var(--ca-navy)]">{row.topic}</p>
              <p className="text-sm text-[var(--ca-navy)]/58">{row.current}</p>
            </div>
          ))}
        </div>
        {story.staticCurrentNote && <p className="mt-3 text-xs text-[var(--ca-navy)]/45">{story.staticCurrentNote}</p>}
      </section>

      <section className="mt-10">
        <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Method</p>
        <h2 className="mt-2 font-heading text-xl font-bold text-[var(--ca-navy)] sm:text-2xl">How to use these notes</h2>
        <ol className="ns-pdp-steps">
          {story.howToUse.map((step, i) => (
            <li key={step}>
              <span>{i + 1}</span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
