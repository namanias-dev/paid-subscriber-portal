"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HELP_TOPICS, topicSlugForPath } from "@/lib/help/registry";

interface HelpData {
  docs: Record<string, string>;
  contact: { whatsapp: string; email: string };
}

interface SearchHit {
  slug: string;
  title: string;
  line: string;
  index: number;
}

const TITLE_BY_SLUG: Record<string, string> = Object.fromEntries(HELP_TOPICS.map((t) => [t.slug, t.title]));

// Tailwind-styled renderers so the docs read well without the typography plugin.
const mdComponents = {
  h1: (p: any) => <h1 className="mb-2 mt-1 font-heading text-xl font-extrabold text-ink" {...p} />,
  h2: (p: any) => <h2 className="mb-2 mt-6 border-b border-line pb-1 font-heading text-base font-bold text-ink" {...p} />,
  h3: (p: any) => <h3 className="mb-1 mt-4 font-heading text-sm font-bold text-ink" {...p} />,
  p: (p: any) => <p className="mb-3 text-[13.5px] leading-relaxed text-ink2" {...p} />,
  ul: (p: any) => <ul className="mb-3 ml-5 list-disc space-y-1 text-[13.5px] text-ink2" {...p} />,
  ol: (p: any) => <ol className="mb-3 ml-5 list-decimal space-y-1 text-[13.5px] text-ink2" {...p} />,
  li: (p: any) => <li className="leading-relaxed" {...p} />,
  strong: (p: any) => <strong className="font-semibold text-ink" {...p} />,
  blockquote: (p: any) => (
    <blockquote className="mb-3 rounded-r-lg border-l-4 border-[var(--primary)] bg-[var(--primary-tint)] px-3 py-2 text-[13px] text-ink2" {...p} />
  ),
  code: (p: any) => <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12px] text-ink" {...p} />,
  pre: (p: any) => <pre className="mb-3 overflow-x-auto rounded-lg bg-surface p-3 text-[12px]" {...p} />,
  a: (p: any) => <a className="font-medium text-[var(--primary)] underline" {...p} />,
  table: (p: any) => (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]" {...p} />
    </div>
  ),
  th: (p: any) => <th className="border border-line bg-surface px-2 py-1 text-left font-semibold text-ink" {...p} />,
  td: (p: any) => <td className="border border-line px-2 py-1 align-top text-ink2" {...p} />,
  hr: () => <hr className="my-4 border-line" />,
};

export default function HelpPanel() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<HelpData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string>("getting-started");
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const routeSlug = useMemo(() => topicSlugForPath(pathname), [pathname]);

  const load = useCallback(async () => {
    if (data) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/help");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load");
      setData({ docs: json.docs || {}, contact: json.contact || { whatsapp: "", email: "" } });
    } catch {
      setError("Could not load the help guides. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [data]);

  function openPanel() {
    setActiveSlug(routeSlug);
    setQuery("");
    setOpen(true);
    void load();
  }

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // After switching docs from a search hit, scroll to & highlight the match.
  useEffect(() => {
    if (!scrollTo || !contentRef.current) return;
    const container = contentRef.current;
    const needle = scrollTo.toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
    let target: HTMLElement | null = null;
    let node = walker.nextNode() as HTMLElement | null;
    while (node) {
      if (node.childElementCount === 0 && (node.textContent || "").toLowerCase().includes(needle)) {
        target = node;
        break;
      }
      node = walker.nextNode() as HTMLElement | null;
    }
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.style.transition = "background-color 1.2s ease";
      target.style.backgroundColor = "var(--primary-tint)";
      const t = setTimeout(() => {
        if (target) target.style.backgroundColor = "";
      }, 1400);
      return () => clearTimeout(t);
    }
  }, [scrollTo, activeSlug]);

  const searchHits = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return [];
    const hits: SearchHit[] = [];
    for (const topic of HELP_TOPICS) {
      const content = data.docs[topic.slug];
      if (!content) continue;
      const lines = content.split("\n");
      let count = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && line.toLowerCase().includes(q)) {
          hits.push({ slug: topic.slug, title: topic.title, line: line.replace(/^#+\s*/, "").replace(/[*`>|]/g, ""), index: i });
          if (++count >= 4) break; // cap per doc to keep results readable
        }
      }
    }
    return hits.slice(0, 60);
  }, [query, data]);

  function openHit(hit: SearchHit) {
    setActiveSlug(hit.slug);
    const snippet = hit.line.slice(0, 40);
    setQuery("");
    // Defer so the new doc renders before we scroll.
    setTimeout(() => setScrollTo(snippet), 60);
  }

  function selectTopic(slug: string) {
    setActiveSlug(slug);
    setQuery("");
    setScrollTo(null);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }

  function handleMdLink(href?: string) {
    if (!href) return false;
    const slug = href.replace(/^\.\//, "").replace(/\.md$/, "").replace(/#.*$/, "");
    if (data?.docs[slug] || TITLE_BY_SLUG[slug]) {
      selectTopic(slug);
      return true;
    }
    return false;
  }

  const contact = data?.contact;
  const waDigits = (contact?.whatsapp || "").replace(/\D/g, "");
  const waNumber = waDigits.length === 10 ? `91${waDigits}` : waDigits;
  const questionContext = `Page: ${pathname}\nQuestion: `;
  const waLink = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(`Hi, I need help with the admin panel.\n${questionContext}${question}`)}`
    : "";
  const mailLink = contact?.email
    ? `mailto:${contact.email}?subject=${encodeURIComponent("Admin panel question")}&body=${encodeURIComponent(`${questionContext}${question}`)}`
    : "";

  const grouped = useMemo(() => {
    const groups: { group: string; topics: typeof HELP_TOPICS }[] = [];
    for (const t of HELP_TOPICS) {
      let g = groups.find((x) => x.group === t.group);
      if (!g) {
        g = { group: t.group, topics: [] };
        groups.push(g);
      }
      g.topics.push(t);
    }
    return groups;
  }, []);

  const activeMarkdown = data?.docs[activeSlug];

  return (
    <>
      {/* Persistent launcher button — appears on every admin page */}
      <button
        onClick={openPanel}
        aria-label="Open Help & Learn"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-line bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
      >
        <span aria-hidden>❓</span>
        <span className="hidden sm:inline">Help &amp; Learn</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside
            role="dialog"
            aria-label="Help and Learn"
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl sm:max-w-lg"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <span aria-hidden>❓</span>
                <div className="font-heading text-sm font-extrabold">Help &amp; Learn</div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close help" className="rounded-lg border border-line px-2 py-1 text-sm text-ink2 hover:text-primary">
                ✕
              </button>
            </div>

            {/* Search */}
            <div className="border-b border-line px-4 py-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search all guides (e.g. offline payment, login code, refund)"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              />
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Topic list (table of contents) */}
              <nav className="hidden w-44 shrink-0 overflow-y-auto border-r border-line p-2 sm:block">
                {grouped.map((g) => (
                  <div key={g.group} className="mb-3">
                    <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{g.group}</p>
                    {g.topics.map((t) => (
                      <button
                        key={t.slug}
                        onClick={() => selectTopic(t.slug)}
                        className="block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] font-medium transition"
                        style={{
                          background: activeSlug === t.slug && !query ? "var(--primary-tint)" : "transparent",
                          color: activeSlug === t.slug && !query ? "var(--primary)" : "var(--ink2)",
                        }}
                      >
                        {t.title}
                      </button>
                    ))}
                  </div>
                ))}
              </nav>

              {/* Content / search results */}
              <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto px-4 py-4">
                {loading && <p className="text-sm text-muted">Loading guides…</p>}
                {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

                {!loading && !error && query.trim() && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                      {searchHits.length} result{searchHits.length === 1 ? "" : "s"} for “{query.trim()}”
                    </p>
                    {searchHits.length === 0 && <p className="text-sm text-ink2">No matches. Try a different word.</p>}
                    <div className="space-y-1.5">
                      {searchHits.map((hit, i) => (
                        <button
                          key={`${hit.slug}-${hit.index}-${i}`}
                          onClick={() => openHit(hit)}
                          className="block w-full rounded-lg border border-line px-3 py-2 text-left transition hover:border-[var(--primary)]"
                        >
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--primary)]">{hit.title}</div>
                          <div className="line-clamp-2 text-[12.5px] text-ink2">{hit.line}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!loading && !error && !query.trim() && activeMarkdown && (
                  <article>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        ...mdComponents,
                        a: ({ href, children, ...rest }: any) => (
                          <a
                            href={href}
                            onClick={(e) => {
                              if (handleMdLink(href)) e.preventDefault();
                            }}
                            className="font-medium text-[var(--primary)] underline"
                            {...rest}
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {activeMarkdown}
                    </ReactMarkdown>
                  </article>
                )}

                {!loading && !error && !query.trim() && !activeMarkdown && (
                  <p className="text-sm text-ink2">No guide found for this page yet. Pick a topic from the list.</p>
                )}
              </div>
            </div>

            {/* Mobile topic chooser */}
            <div className="border-t border-line px-4 py-2 sm:hidden">
              <select
                value={query ? "" : activeSlug}
                onChange={(e) => e.target.value && selectTopic(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              >
                <option value="" disabled>
                  Jump to a topic…
                </option>
                {HELP_TOPICS.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Ask a question */}
            <details className="border-t border-line px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink">Ask a question</summary>
              <p className="mt-2 text-[12px] text-muted">Can’t find the answer? Send your question to an admin.</p>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={2}
                placeholder="Type your question…"
                className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {waLink ? (
                  <a href={waLink} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white">
                    Ask on WhatsApp
                  </a>
                ) : null}
                {mailLink ? (
                  <a href={mailLink} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink2">
                    Ask via email
                  </a>
                ) : null}
                {!waLink && !mailLink ? (
                  <span className="text-[12px] text-muted">Set a WhatsApp number / support email in Settings to enable this.</span>
                ) : null}
              </div>
            </details>
          </aside>
        </div>
      )}
    </>
  );
}
