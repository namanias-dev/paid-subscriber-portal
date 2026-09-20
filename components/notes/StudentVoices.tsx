"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Globe2,
  Landmark,
  Leaf,
  Newspaper,
  Scale,
  ScrollText,
  GraduationCap,
} from "lucide-react";
import { trackClient } from "@/lib/analytics/client";
import type { PreferenceSubject } from "@/lib/store/preferenceLogic";

const ICONS: Record<string, typeof Landmark> = {
  polity: Landmark,
  "modern-history": ScrollText,
  "ancient-history": ScrollText,
  geography: Globe2,
  economy: Scale,
  environment: Leaf,
  ethics: BookOpen,
  "current-affairs": Newspaper,
  optionals: GraduationCap,
};

function SubjectIcon({ slug }: { slug: string }) {
  const Icon = ICONS[slug] || BookOpen;
  return <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />;
}

function DemandBar({ share, selected, reduce }: { share: number; selected: boolean; reduce: boolean | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const width = inView ? `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%` : "0%";
  return (
    <div ref={ref} className="ns-demand-track mt-2" aria-hidden="true">
      <div
        className={`ns-demand-fill ${selected ? "opacity-100" : "opacity-90"}`}
        style={{
          width,
          transition: reduce ? "none" : "width 780ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
    </div>
  );
}

export default function StudentVoices({ subjects }: { subjects: PreferenceSubject[] }) {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const viewed = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [rows, setRows] = useState(subjects);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<PreferenceSubject[]>([]);
  const [waitlist, setWaitlist] = useState<PreferenceSubject[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notes/preferences", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j.ok) return;
        if (Array.isArray(j.subjects) && j.subjects.length) setRows(j.subjects);
        if (Array.isArray(j.selected)) {
          setSelected(j.selected);
          if (j.selected.length && j.saved) {
            const chosen = (j.subjects || subjects).filter((s: PreferenceSubject) => j.selected.includes(s.id));
            setAvailable(chosen.filter((s: PreferenceSubject) => s.available));
            setWaitlist(chosen.filter((s: PreferenceSubject) => !s.available));
            setSaved(true);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [subjects]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || viewed.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !viewed.current) {
          viewed.current = true;
          trackClient("notes_interest_section_viewed", { subject_count: rows.length });
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length]);

  const selectedRows = useMemo(
    () => rows.filter((s) => selected.includes(s.id)),
    [rows, selected],
  );

  function toggle(id: string) {
    const subject = rows.find((s) => s.id === id);
    setSaved(false);
    setError(null);
    setSelected((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      trackClient(cur.includes(id) ? "subject_interest_removed" : "subject_interest_selected", {
        subject_id: id,
        subject_slug: subject?.slug,
      });
      return next;
    });
  }

  async function save() {
    if (!selected.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/notes/preferences", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category_ids: selected, source: "voices" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Unable to save preferences right now.");
      setAvailable(json.available || []);
      setWaitlist(json.waitlist || []);
      setUpdated(!!json.updated);
      setSaved(true);
      trackClient(json.updated ? "interest_preferences_updated" : "subject_interest_saved", {
        subject_ids: json.selected,
        available_count: (json.available || []).length,
        waitlist_count: (json.waitlist || []).length,
      });
      if ((json.waitlist || []).length) {
        trackClient("waitlist_interest_saved", {
          subject_ids: (json.waitlist || []).map((s: PreferenceSubject) => s.id),
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!rows.length) return null;

  return (
    <section
      ref={sectionRef}
      id="student-voices"
      className="relative overflow-hidden rounded-[28px] border border-[var(--ca-navy)]/8 bg-[linear-gradient(180deg,#ffffff_0%,#fbf8f2_100%)] px-4 py-8 ns-elev-1 sm:px-6 sm:py-10"
    >
      <div className="pointer-events-none absolute -right-10 top-0 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.14),transparent_68%)]" aria-hidden="true" />
      <div className="lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)] lg:items-start lg:gap-10">
        <div>
          <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Student voices</p>
          <h2 id="voices-title" className="mt-2 font-heading text-2xl font-bold text-[var(--ca-navy)] sm:text-3xl">
            Which subjects&apos; notes do you want?
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--ca-navy)]/58">
            Choose as many as you&apos;d like. Your choices help us understand what aspirants actually need.
          </p>

          <AnimatePresence mode="wait">
            {saved ? (
              <motion.div
                key="done"
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6"
              >
                <p className="font-heading text-xl font-bold text-[var(--ca-navy)]">
                  {updated ? "Updated — we have your latest preferences." : "Perfect — we\u2019ve got your preferences."}
                </p>
                <p className="mt-2 text-sm text-[var(--ca-navy)]/60">
                  We&apos;ll use your choices to plan future handwritten notes and subject combinations aspirants actually want.
                </p>
                {available.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-4">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-emerald-900">
                      {available.length} available right now
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {available.map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-3 text-sm text-[var(--ca-navy)]">
                          <span className="font-semibold">{s.name}</span>
                          <Link
                            href={s.href}
                            className="ca-focus text-xs font-bold uppercase tracking-[0.12em] text-emerald-800"
                            onClick={() =>
                              trackClient("available_note_clicked_from_interest", {
                                subject_id: s.id,
                                subject_slug: s.slug,
                              })
                            }
                          >
                            View →
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {available[0] && (
                      <Link
                        href={available.length === 1 ? available[0].href : "#catalogue"}
                        className="ca-btn ca-btn-gold ca-focus ns-press mt-4 rounded-full px-5 text-sm"
                      >
                        View my available notes →
                      </Link>
                    )}
                  </div>
                )}
                {waitlist.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-[var(--ca-navy)]/10 bg-white px-4 py-4">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ca-navy)]">
                      {waitlist.length} on your interest list
                    </p>
                    <ul className="mt-2 space-y-1 text-sm font-semibold text-[var(--ca-navy)]/80">
                      {waitlist.map((s) => (
                        <li key={s.id}>{s.name}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-[var(--ca-navy)]/50">
                      We&apos;ll use your interest as we plan upcoming notes. This is not a notification subscription.
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  className="ca-focus mt-5 text-sm font-semibold text-[var(--ca-navy)]/70 underline-offset-4 hover:underline"
                  onClick={() => setSaved(false)}
                >
                  Update my subjects
                </button>
              </motion.div>
            ) : (
              <motion.div key="form" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
                <div role="group" aria-labelledby="voices-title" className="grid gap-2">
                  {rows.map((subject) => {
                    const on = selected.includes(subject.id);
                    return (
                      <label
                        key={subject.id}
                        className={`ns-voices-row ca-focus ns-press flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors ${
                          on
                            ? "border-[rgba(212,175,55,0.55)] bg-[rgba(252,233,168,0.28)] ns-elev-2"
                            : "border-[var(--ca-navy)]/8 bg-white"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={() => toggle(subject.id)}
                        />
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ca-surface)] text-[var(--ca-navy)]">
                          <SubjectIcon slug={subject.slug} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-3">
                            <span className="font-heading text-[15px] font-bold text-[var(--ca-navy)]">{subject.name}</span>
                            <span
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                                on ? "bg-[var(--ca-gold)] text-[var(--ca-navy)]" : "bg-[var(--ca-navy)]/6 text-[var(--ca-navy)]/55"
                              }`}
                              aria-hidden="true"
                            >
                              {on ? "✓" : "+"}
                            </span>
                          </span>
                          {subject.meta && <span className="mt-0.5 block text-xs text-[var(--ca-navy)]/48">{subject.meta}</span>}
                          <DemandBar share={subject.demand_share} selected={on} reduce={reduce} />
                          <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ca-navy)]/40">
                            {on ? (subject.available ? "Interested · available now" : "Interested · on my list") : subject.demand_label || (subject.demand_count != null ? `${subject.demand_count.toLocaleString("en-IN")} interested` : "\u00a0")}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {error && (
                  <p className="mt-3 text-sm text-red-700" role="alert">
                    {error}
                  </p>
                )}
                <div className="mt-5 hidden lg:block">
                  <button
                    type="button"
                    onClick={save}
                    disabled={!selected.length || saving}
                    className="ca-btn ca-btn-gold ca-focus ns-press rounded-full px-6 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save my interests →"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="mt-8 rounded-2xl border border-[var(--ca-navy)]/8 bg-white/80 p-5 lg:mt-10">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Why we ask</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ca-navy)]/62">
            Your choices help us understand which handwritten notes matter most and which subject combinations make sense together.
          </p>
          <ul className="mt-4 space-y-2 text-sm font-semibold text-[var(--ca-navy)]">
            <li>Future notes</li>
            <li>Better bundles</li>
            <li>Availability planning</li>
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-[var(--ca-navy)]/45">
            Saving interest is a demand signal, not an order and not a marketing subscription.
          </p>
        </aside>
      </div>

      {!saved && selected.length > 0 && <div className="h-28 lg:hidden" aria-hidden="true" />}

      {mounted &&
        createPortal(
          <AnimatePresence>
            {!saved && selected.length > 0 && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: 16 }}
                className="ns-voices-tray fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ca-navy)]/10 bg-white/96 px-4 pt-3 shadow-[0_-12px_32px_-18px_rgba(10,26,63,0.35)] backdrop-blur-md lg:hidden"
              >
                <p className="text-xs font-semibold text-[var(--ca-navy)]">
                  {selected.length} subject{selected.length === 1 ? "" : "s"} selected
                </p>
                <div className="mt-2 flex gap-2 overflow-x-auto ns-hide-scrollbar">
                  {selectedRows.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggle(s.id)}
                      className="ca-focus shrink-0 rounded-full border border-[var(--ca-navy)]/12 bg-[var(--ca-surface)] px-3 py-1 text-xs font-semibold text-[var(--ca-navy)]"
                    >
                      {s.name} ×
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="ca-btn ca-btn-gold ca-focus ns-press mt-3 w-full rounded-full disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save my interests →"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </section>
  );
}
