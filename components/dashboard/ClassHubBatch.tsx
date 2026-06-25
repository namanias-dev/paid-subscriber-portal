"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Video, FileText, BarChart3, Newspaper, Search, Lock, PlayCircle, ExternalLink, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatISTDate } from "@/lib/dates";
import type { ClassHubSection, ClassHubSectionId, ClassHubItem } from "@/lib/classHub";
import type { PerformanceData } from "@/lib/performance";
import { PERFORMANCE_SECTION } from "@/lib/performance";
import PerformanceDashboard from "./PerformanceDashboard";

type TabId = ClassHubSectionId | typeof PERFORMANCE_SECTION;

const SECTION_ICON: Record<string, LucideIcon> = {
  recordings: Video,
  notes: FileText,
  ca: Newspaper,
  [PERFORMANCE_SECTION]: BarChart3,
};

/**
 * Premium per-batch Class Hub: content section tabs (Recordings / Notes / CA)
 * PLUS a "My Performance" dashboard tab — all with NEW counts, in-hub search,
 * drip-locked states, and self-clearing NEW badges (opening a tab marks it seen
 * server-side; badges render from server truth for the current visit).
 */
export default function ClassHubBatch({
  courseId,
  sections,
  performance,
}: {
  courseId: string;
  sections: ClassHubSection[];
  performance: PerformanceData;
}) {
  const hasContent = sections.some((s) => s.items.length > 0);
  const hasPerformance = performance.quizzes.length > 0 || performance.history.length > 0;
  const initial: TabId = hasContent
    ? sections.find((s) => s.items.length > 0)!.id
    : hasPerformance
      ? PERFORMANCE_SECTION
      : sections[0]?.id ?? "recordings";
  const [active, setActive] = useState<TabId>(initial);
  const [query, setQuery] = useState("");
  const marked = useRef<Set<string>>(new Set());

  const newCountFor = (id: TabId) =>
    id === PERFORMANCE_SECTION ? performance.newCount : sections.find((s) => s.id === id)?.newCount ?? 0;

  // Mark a tab seen (once per mount) when it becomes active. We DON'T hide the
  // badges in this render — they stay visible for the current visit (the server
  // computed `isNew`/newCount from the pre-visit last_seen). On the next load the
  // server recomputes against the updated last_seen, so opened tabs clear and
  // only genuinely newer items still show NEW.
  useEffect(() => {
    const key = `${courseId}:${active}`;
    if (marked.current.has(key)) return;
    marked.current.add(key);
    if (newCountFor(active) === 0) return;
    fetch("/api/classhub/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, section: active }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, courseId, sections, performance]);

  const activeSection = sections.find((s) => s.id === active);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !activeSection) return activeSection?.items ?? [];
    return activeSection.items.filter(
      (i) => i.title.toLowerCase().includes(q) || (i.subject || "").toLowerCase().includes(q),
    );
  }, [activeSection, query]);

  const tabs: { id: TabId; label: string }[] = [
    ...sections.map((s) => ({ id: s.id as TabId, label: s.label })),
    { id: PERFORMANCE_SECTION, label: "My Performance" },
  ];
  const onPerformance = active === PERFORMANCE_SECTION;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
          <PlayCircle size={18} className="text-[var(--ca-gold)]" /> Batch content
        </h2>
        {!onPerformance && activeSection && activeSection.items.length > 0 && (
          <label className="relative flex items-center">
            <Search size={15} className="pointer-events-none absolute left-3 text-muted" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this section…"
              className="input min-h-[44px] w-full pl-9 sm:w-64"
              aria-label="Search batch content"
            />
          </label>
        )}
      </div>

      {/* Tabs */}
      <div className="no-scrollbar mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
        {tabs.map((t) => {
          const Icon = SECTION_ICON[t.id];
          const isActive = t.id === active;
          const count = newCountFor(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              aria-pressed={isActive}
              className={`ca-focus inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-all duration-200 motion-reduce:transition-none ${
                isActive
                  ? "bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)] text-[#1a1304] shadow-[0_8px_20px_-8px_rgba(212,175,55,0.6)]"
                  : "border border-line bg-surface text-ink2 hover:border-[rgba(212,175,55,0.6)] hover:text-ink"
              }`}
            >
              {Icon && <Icon size={15} aria-hidden="true" />}
              {t.label}
              {count > 0 && (
                <span className="inline-flex items-center rounded-full bg-[#16a34a] px-1.5 text-[11px] font-extrabold leading-5 text-white">
                  {count} new
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {onPerformance ? (
          <PerformanceDashboard data={performance} />
        ) : !activeSection || activeSection.items.length === 0 ? (
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

function fmtDuration(s?: number | null): string | null {
  if (!s || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function ContentRow({ item }: { item: ClassHubItem }) {
  const showNew = item.isNew;

  const cardCls =
    "block h-full rounded-2xl border border-line bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(212,175,55,0.5)] hover:shadow-soft motion-reduce:transform-none motion-reduce:transition-none";

  // Hosted lecture card — thumbnail, duration, progress, access chip.
  if (item.hosted) {
    const dur = fmtDuration(item.durationSeconds);
    const inner = (
      <div className={`${cardCls} ${item.accessBlocked ? "opacity-95" : ""} !p-0 overflow-hidden`}>
        <div className="relative aspect-video w-full bg-gradient-to-br from-[#0b1437] to-[#1c2d6b]">
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/70">
              <PlayCircle size={40} />
            </div>
          )}
          {!item.accessBlocked && !item.locked && (
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
                <PlayCircle size={26} />
              </span>
            </span>
          )}
          {dur && <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">{dur}</span>}
          {showNew && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)] px-2 py-0.5 text-[10px] font-extrabold text-[#1a1304]">
              <Sparkles size={10} /> NEW
            </span>
          )}
          {item.completed && (
            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[10px] font-extrabold text-white">✓ Completed</span>
          )}
          {item.accessBlocked && <span className="absolute inset-0 grid place-items-center bg-black/45 text-white"><Lock size={26} /></span>}
          {!!item.progressPct && item.progressPct > 0 && !item.completed && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
              <span className="block h-full bg-[var(--ca-gold)]" style={{ width: `${item.progressPct}%` }} />
            </span>
          )}
        </div>
        <div className="p-4">
          <p className="line-clamp-2 font-semibold leading-snug text-ink">
            {item.classNo != null && <span className="text-[var(--ca-gold)]">Class {item.classNo} · </span>}
            {item.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
            <span>Recording</span>
            {item.subject && <span>· {item.subject}</span>}
            {item.date && <span>· {formatISTDate(item.date)}</span>}
          </div>
          {item.locked ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
              <Lock size={12} /> Unlocks on {item.unlockOn ? formatISTDate(item.unlockOn) : "a later date"}
            </p>
          ) : item.accessBlocked ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
              <Lock size={12} /> {item.accessLabel || "Locked"}
            </p>
          ) : (
            <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
              {item.progressPct && item.progressPct > 0 ? "Continue watching" : "Watch now"} <PlayCircle size={13} />
              {item.accessLabel && <span className="ml-1 text-xs font-normal text-muted">· {item.accessLabel}</span>}
            </span>
          )}
        </div>
      </div>
    );
    if (item.locked || item.accessBlocked || !item.link) return <li>{inner}</li>;
    return <li><Link href={item.link} className="ca-focus block">{inner}</Link></li>;
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
