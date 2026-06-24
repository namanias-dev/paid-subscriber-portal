"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Video, FileText, ListChecks, Newspaper, Search, Lock, PlayCircle, ExternalLink, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatISTDate } from "@/lib/dates";
import type { ClassHubSection, ClassHubSectionId, ClassHubItem } from "@/lib/classHub";
import QuizAttemptActions from "@/components/public/quiz/QuizAttemptActions";

const SECTION_ICON: Record<ClassHubSectionId, LucideIcon> = {
  recordings: Video,
  notes: FileText,
  tests: ListChecks,
  ca: Newspaper,
};

/**
 * Premium per-batch Class Hub content: section tabs with NEW counts, in-hub
 * search, drip-locked states, external links — and self-clearing NEW badges
 * (opening a section marks it seen server-side).
 */
export default function ClassHubBatch({ courseId, sections }: { courseId: string; sections: ClassHubSection[] }) {
  const firstWithItems = sections.find((s) => s.items.length > 0)?.id ?? sections[0]?.id ?? "recordings";
  const [active, setActive] = useState<ClassHubSectionId>(firstWithItems);
  const [query, setQuery] = useState("");
  const marked = useRef<Set<string>>(new Set());

  // Mark a section seen (once per mount) when it becomes active. We DON'T hide
  // the badges in this render — they stay visible for the current visit (the
  // server already computed `isNew` from the pre-visit last_seen). On the next
  // load the server recomputes against the updated last_seen, so opened sections
  // are cleared and only genuinely newer items still show NEW.
  useEffect(() => {
    const key = `${courseId}:${active}`;
    if (marked.current.has(key)) return;
    marked.current.add(key);
    const section = sections.find((s) => s.id === active);
    if (!section || section.newCount === 0) return;
    fetch("/api/classhub/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, section: active }),
    }).catch(() => {});
  }, [active, courseId, sections]);

  const activeSection = sections.find((s) => s.id === active) ?? sections[0];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !activeSection) return activeSection?.items ?? [];
    return activeSection.items.filter(
      (i) => i.title.toLowerCase().includes(q) || (i.subject || "").toLowerCase().includes(q),
    );
  }, [activeSection, query]);

  const hasAnything = sections.some((s) => s.items.length > 0);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
          <PlayCircle size={18} className="text-[var(--ca-gold)]" /> Batch content
        </h2>
        {hasAnything && (
          <label className="relative flex items-center">
            <Search size={15} className="pointer-events-none absolute left-3 text-muted" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this batch…"
              className="input min-h-[44px] w-full pl-9 sm:w-64"
              aria-label="Search batch content"
            />
          </label>
        )}
      </div>

      {/* Section tabs */}
      <div className="no-scrollbar mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
        {sections.map((s) => {
          const Icon = SECTION_ICON[s.id];
          const isActive = s.id === active;
          const count = s.newCount;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              aria-pressed={isActive}
              className={`ca-focus inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-all duration-200 motion-reduce:transition-none ${
                isActive
                  ? "bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)] text-[#1a1304] shadow-[0_8px_20px_-8px_rgba(212,175,55,0.6)]"
                  : "border border-line bg-surface text-ink2 hover:border-[rgba(212,175,55,0.6)] hover:text-ink"
              }`}
            >
              <Icon size={15} aria-hidden="true" />
              {s.label}
              {count > 0 && (
                <span className="inline-flex items-center rounded-full bg-[#16a34a] px-1.5 text-[11px] font-extrabold leading-5 text-white">
                  {count} new
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Items */}
      <div className="mt-5">
        {!activeSection || activeSection.items.length === 0 ? (
          <EmptyHub message={activeSection?.empty ?? "Nothing here yet."} />
        ) : filtered.length === 0 ? (
          <EmptyHub message="No items match your search." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {filtered.map((item) => (
              <ContentRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ContentRow({ item }: { item: ClassHubItem }) {
  const showNew = item.isNew;

  const cardCls =
    "block h-full rounded-2xl border border-line bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(212,175,55,0.5)] hover:shadow-soft motion-reduce:transform-none motion-reduce:transition-none";

  // Attempted quiz → show ✓ score + report/PDF (reused everywhere) in a static card.
  if (item.attempt && item.quizSlug) {
    return (
      <li>
        <div className={cardCls}>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface2 text-ink2"><ListChecks size={16} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="line-clamp-2 font-semibold leading-snug text-ink">{item.title}</p>
                {showNew && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)] px-2 py-0.5 text-[10px] font-extrabold text-[#1a1304]">
                    <Sparkles size={10} /> NEW
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                <span>{item.typeLabel}</span>
                {item.subject && <span>· {item.subject}</span>}
              </div>
              <div className="mt-3">
                <QuizAttemptActions slug={item.quizSlug} status={item.attempt} retakeHref={`/quizzes/${item.quizSlug}/attempt`} />
              </div>
            </div>
          </div>
        </div>
      </li>
    );
  }

  const body = (
    <div className="flex h-full items-start gap-3">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface2 text-ink2">
        {item.type === "recording" || item.type === "live_link" ? <Video size={16} /> : <FileText size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 font-semibold leading-snug text-ink">
            {item.classNo != null && <span className="text-[var(--ca-gold)]">Class {item.classNo} · </span>}
            {item.title}
          </p>
          {showNew && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)] px-2 py-0.5 text-[10px] font-extrabold text-[#1a1304]">
              <Sparkles size={10} /> NEW
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
          <span>{item.typeLabel}</span>
          {item.subject && <span>· {item.subject}</span>}
          {item.date && <span>· {formatISTDate(item.date)}</span>}
        </div>
        {item.locked ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
            <Lock size={12} /> Unlocks on {item.unlockOn ? formatISTDate(item.unlockOn) : "a later date"}
          </p>
        ) : (
          <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            {item.action} {item.external ? <ExternalLink size={13} /> : <PlayCircle size={13} />}
          </span>
        )}
      </div>
    </div>
  );

  if (item.locked || !item.link) {
    return <li><div className={`${cardCls} opacity-90`}>{body}</div></li>;
  }
  if (item.external) {
    return (
      <li>
        <a href={item.link} target="_blank" rel="noopener noreferrer" className={`ca-focus ${cardCls}`}>{body}</a>
      </li>
    );
  }
  return (
    <li>
      <Link href={item.link} className={`ca-focus ${cardCls}`}>{body}</Link>
    </li>
  );
}

function EmptyHub({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface2/40 p-10 text-center">
      <p className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-surface text-muted">
        <Sparkles size={18} aria-hidden="true" />
      </p>
      <p className="text-sm font-medium text-ink2">{message}</p>
    </div>
  );
}
