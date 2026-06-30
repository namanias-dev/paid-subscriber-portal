"use client";

/**
 * Learning — in-portal staff help center.
 *
 * This page is intentionally "dumb": all wording lives in `lib/learning/content.ts`
 * as plain data, and this file only lays it out (table of contents, search,
 * collapsible groups, and markdown rendering). To change the words, edit the data
 * file — you rarely need to touch this page.
 *
 * Gating: this page sits under `app/admin/*`, which is wrapped by `AdminShell`.
 * AdminShell already requires a logged-in admin, so any staff member can open it.
 */

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/admin/ui";
import {
  SCENARIOS,
  SECTIONS,
  PORTAL_LINKS,
  ROLE_MATRIX,
  type LearnProcedure,
  type LearnScenario,
} from "@/lib/learning/content";

/* Inline markdown (no wrapping <p>) — for step lines, who-text, etc. */
const inlineMd = {
  p: (p: any) => <>{p.children}</>,
  strong: (p: any) => <strong className="font-semibold text-ink" {...p} />,
  a: (p: any) => <a className="font-medium text-[var(--primary)] underline" {...p} />,
  code: (p: any) => <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12px] text-ink" {...p} />,
};
const blockMd = {
  ...inlineMd,
  p: (p: any) => <p className="mb-2 text-[13.5px] leading-relaxed text-ink2" {...p} />,
};

function Inline({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineMd as any}>
      {children}
    </ReactMarkdown>
  );
}
function Block({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={blockMd as any}>
      {children}
    </ReactMarkdown>
  );
}

/* Build one lowercase haystack per card so the search box can match anything. */
function haystack(p: LearnProcedure & Partial<LearnScenario>): string {
  return [
    p.question,
    p.title,
    p.intro,
    p.who,
    ...(p.steps || []),
    ...(p.mistakes || []),
    p.check,
    p.example?.title,
    ...(p.example?.lines || []),
    ...(p.keywords || []),
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
}

function WhoBadge({ who }: { who?: string }) {
  if (!who) return null;
  return (
    <div className="mt-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-ink2">
      <span className="font-semibold text-ink">👤 Who can do this: </span>
      <Inline>{who}</Inline>
    </div>
  );
}

function QuickLink({ link }: { link?: { label: string; href: string } }) {
  if (!link) return null;
  return (
    <a
      href={link.href}
      className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-[12px] font-semibold text-[var(--primary)] transition hover:border-[var(--primary)]"
    >
      🔗 {link.label}
    </a>
  );
}

function ProcedureBody({ p }: { p: LearnProcedure & Partial<LearnScenario> }) {
  return (
    <div className="space-y-3">
      {p.quickLink && <QuickLink link={p.quickLink} />}
      {p.intro && <Block>{p.intro}</Block>}
      <WhoBadge who={p.who} />

      {p.steps && p.steps.length > 0 && (
        <ol className="ml-5 list-decimal space-y-1.5 text-[13.5px] text-ink2">
          {p.steps.map((s, i) => (
            <li key={i} className="leading-relaxed">
              <Inline>{s}</Inline>
            </li>
          ))}
        </ol>
      )}

      {p.check && (
        <div className="rounded-lg border border-[var(--success)] bg-[#e9f7ef] px-3 py-2 text-[13px] text-[#166534]">
          <span className="font-semibold">✅ How to check it worked: </span>
          <Inline>{p.check}</Inline>
        </div>
      )}

      {p.mistakes && p.mistakes.length > 0 && (
        <div className="rounded-lg border border-[var(--warning)] bg-[#fef3e2] px-3 py-2 text-[13px] text-[#8a5a00]">
          <p className="mb-1 font-semibold">⚠️ Common mistakes to avoid</p>
          <ul className="ml-5 list-disc space-y-1">
            {p.mistakes.map((m, i) => (
              <li key={i}>
                <Inline>{m}</Inline>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.example && (
        <div className="rounded-lg border border-line bg-[var(--primary-tint)] px-3 py-2 text-[13px] text-ink2">
          <p className="mb-1 font-semibold text-ink">📋 Real example — {p.example.title}</p>
          <ul className="ml-5 list-disc space-y-1">
            {p.example.lines.map((l, i) => (
              <li key={i}>
                <Inline>{l}</Inline>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProcedureCard({ p }: { p: LearnProcedure }) {
  return (
    <div id={`p-${p.id}`} className="card p-4">
      <h3 className="font-heading text-[15px] font-bold text-ink">{p.title}</h3>
      <div className="mt-2">
        <ProcedureBody p={p} />
      </div>
    </div>
  );
}

function ScenarioCard({ s }: { s: LearnScenario }) {
  const sectionTitle = SECTIONS.find((x) => x.id === s.relatedSection)?.title;
  return (
    <div id={`p-${s.id}`} className="card border-l-4 border-[var(--primary)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--primary)]">Staff question</p>
      <h3 className="mt-0.5 font-heading text-[15px] font-bold text-ink">“{s.question}”</h3>
      <div className="mt-2">
        <ProcedureBody p={s} />
      </div>
      {sectionTitle && (
        <p className="mt-3 text-[12px] text-muted">
          Read the full topic: <span className="font-semibold text-ink2">{sectionTitle}</span> (below).
        </p>
      )}
    </div>
  );
}

/* Collapsible group wrapper with a controlled open state. */
function Group({
  id,
  title,
  icon,
  summary,
  open,
  onToggle,
  quickLink,
  children,
}: {
  id: string;
  title: string;
  icon?: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  quickLink?: { label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="card overflow-hidden p-0">
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          aria-expanded={open}
        >
          <div className="flex items-center gap-2.5">
            {icon && <span className="text-lg">{icon}</span>}
            <div>
              <div className="font-heading text-base font-bold text-ink">{title}</div>
              {summary && <div className="mt-0.5 text-[12.5px] text-muted">{summary}</div>}
            </div>
          </div>
          <span className="shrink-0 text-ink2">{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <div className="space-y-3 border-t border-line bg-surface/50 p-4">
            {quickLink && <QuickLink link={quickLink} />}
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

export default function LearningPage() {
  const [query, setQuery] = useState("");
  // Which collapsible groups are open. Scenarios open by default; topics closed.
  const [open, setOpen] = useState<Record<string, boolean>>({ scenarios: true });

  const q = query.trim().toLowerCase();

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const openAndScroll = (id: string) => {
    setOpen((o) => ({ ...o, [id]: true }));
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  // Flat search results across scenarios + every procedure.
  const results = useMemo(() => {
    if (!q) return null;
    const scenarioHits = SCENARIOS.filter((s) => haystack(s).includes(q));
    const procHits: { sectionTitle: string; p: LearnProcedure }[] = [];
    for (const sec of SECTIONS) {
      for (const p of sec.procedures) {
        if (haystack(p).includes(q)) procHits.push({ sectionTitle: sec.title, p });
      }
    }
    return { scenarioHits, procHits };
  }, [q]);

  return (
    <div>
      <PageHeader
        title="Learning"
        subtitle="Your in-portal help center — real examples, step-by-step, written for everyone."
      />

      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-6">
        {/* Sticky table of contents */}
        <aside className="mb-4 lg:mb-0">
          <div className="lg:sticky lg:top-20">
            <div className="card p-3">
              <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">On this page</p>
              <nav className="space-y-0.5">
                <button onClick={() => openAndScroll("scenarios")} className="block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] font-medium text-ink2 hover:bg-surface">
                  ⭐ Common Staff Questions
                </button>
                <button onClick={() => openAndScroll("links")} className="block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] font-medium text-ink2 hover:bg-surface">
                  🔗 All Portal Links
                </button>
                <button onClick={() => openAndScroll("roles")} className="block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] font-medium text-ink2 hover:bg-surface">
                  👥 Who Can Do What
                </button>
                <div className="my-1 border-t border-line" />
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => openAndScroll(`sec-${s.id}`)}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] font-medium text-ink2 hover:bg-surface"
                  >
                    {s.icon} {s.title}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </aside>

        {/* Main column */}
        <div className="min-w-0 space-y-4">
          {/* Search */}
          <div className="card p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search everything — e.g. ‘paid but failed’, ‘offline price’, ‘recording’, ‘login code’"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"
            />
            {q && (
              <p className="mt-2 px-1 text-[12px] text-muted">
                {(results?.scenarioHits.length || 0) + (results?.procHits.length || 0)} result(s) for “{query.trim()}”.{" "}
                <button onClick={() => setQuery("")} className="font-semibold text-[var(--primary)] underline">
                  Clear
                </button>
              </p>
            )}
          </div>

          {/* SEARCH RESULTS VIEW */}
          {q && results && (
            <div className="space-y-3">
              {results.scenarioHits.length === 0 && results.procHits.length === 0 && (
                <div className="card p-4 text-sm text-ink2">No matches. Try a simpler word like “price”, “webinar”, or “login”.</div>
              )}
              {results.scenarioHits.map((s) => (
                <ScenarioCard key={s.id} s={s} />
              ))}
              {results.procHits.map(({ sectionTitle, p }) => (
                <div key={p.id}>
                  <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{sectionTitle}</p>
                  <ProcedureCard p={p} />
                </div>
              ))}
            </div>
          )}

          {/* BROWSE VIEW (no search) */}
          {!q && (
            <>
              {/* Scenarios first — staff think in problems */}
              <Group
                id="scenarios"
                title="Common Staff Questions / Scenarios"
                icon="⭐"
                summary="Real questions in plain words, answered end-to-end. Start here."
                open={!!open.scenarios}
                onToggle={() => toggle("scenarios")}
              >
                {SCENARIOS.map((s) => (
                  <ScenarioCard key={s.id} s={s} />
                ))}
              </Group>

              {/* Master portal links */}
              <Group
                id="links"
                title="All Portal Links"
                icon="🔗"
                summary="Every admin screen and who needs access. Click to open."
                open={!!open.links}
                onToggle={() => toggle("links")}
              >
                <div className="card overflow-x-auto p-0">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                        <th className="px-4 py-3 font-semibold">Screen</th>
                        <th className="px-4 py-3 font-semibold">Link</th>
                        <th className="px-4 py-3 font-semibold">Who needs access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PORTAL_LINKS.map((l) => (
                        <tr key={l.href} className="border-b border-line/60">
                          <td className="px-4 py-2.5 font-medium text-ink">{l.label}</td>
                          <td className="px-4 py-2.5">
                            <a href={l.href} className="font-mono text-[12px] text-[var(--primary)] underline">
                              {l.href}
                            </a>
                          </td>
                          <td className="px-4 py-2.5 text-ink2">{l.whoNeeds}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-1 text-[12px] text-muted">
                  Tip: for screens that need an id (like a course), open the list page and click the row — the id fills in
                  automatically, e.g. <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">/admin/courses/[COURSE-ID]</code>.
                </p>
              </Group>

              {/* Roles matrix */}
              <Group
                id="roles"
                title="Who Can Do What (roles & permissions)"
                icon="👥"
                summary="What each role can and cannot do."
                open={!!open.roles}
                onToggle={() => toggle("roles")}
              >
                <div className="card overflow-x-auto p-0">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                        <th className="px-4 py-3 font-semibold">Role</th>
                        <th className="px-4 py-3 font-semibold">Can do</th>
                        <th className="px-4 py-3 font-semibold">Cannot do</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ROLE_MATRIX.map((r) => (
                        <tr key={r.role} className="border-b border-line/60 align-top">
                          <td className="px-4 py-2.5 font-semibold text-ink">{r.role}</td>
                          <td className="px-4 py-2.5 text-ink2">{r.can}</td>
                          <td className="px-4 py-2.5 text-ink2">{r.cannot}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Group>

              {/* Topic sections */}
              {SECTIONS.map((sec) => (
                <Group
                  key={sec.id}
                  id={`sec-${sec.id}`}
                  title={sec.title}
                  icon={sec.icon}
                  summary={sec.summary}
                  open={!!open[`sec-${sec.id}`]}
                  onToggle={() => toggle(`sec-${sec.id}`)}
                  quickLink={sec.quickLink}
                >
                  {sec.procedures.map((p) => (
                    <ProcedureCard key={p.id} p={p} />
                  ))}
                </Group>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
