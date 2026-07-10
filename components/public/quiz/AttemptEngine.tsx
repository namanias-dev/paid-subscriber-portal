"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatQuestionHtml } from "@/lib/quizFormat";
import { setAppBusy } from "@/lib/appBusy";
import { ga4Event } from "@/lib/analytics/ga4";

interface ClientQuestion {
  question_id: string;
  order: number;
  question_html: string;
  question_image: string | null;
  options: { key: string; html: string }[];
  subject: string | null;
  topic: string | null;
  difficulty: string | null;
  section: string | null;
}

type AnswerMap = Record<string, string | null>;

function fmt(sec: number) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return (h ? `${h}:` : "") + `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export default function AttemptEngine({
  apiBase,
  slug,
  resultBase,
}: {
  apiBase: string;
  slug: string;
  resultBase: string;
}) {
  const router = useRouter();
  // GA4 quiz events fire ONLY for the public quiz flow (this engine is reused by
  // the private portal/dashboard). GA4 is also path-gated, so this is belt-and-braces.
  const isPublicQuiz = apiBase.includes("/public");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ reason?: string; message: string } | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ClientQuestion[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [showTimer, setShowTimer] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submittedRef = useRef(false);

  const storageKey = `quiz_local_${slug}`;

  const doSubmit = useCallback(async (auto = false) => {
    if (submittedRef.current || !attemptId) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, auto }),
      });
      const data = await res.json();
      if (data.ok) {
        if (isPublicQuiz) ga4Event("quiz_complete", { quiz_slug: slug, auto });
        localStorage.removeItem(storageKey);
        router.push(`${resultBase}/${data.attemptId}`);
      } else {
        submittedRef.current = false;
        setError({ message: data.error || "Failed to submit." });
      }
    } catch {
      submittedRef.current = false;
      setError({ message: "Network error during submit." });
    } finally {
      setSubmitting(false);
    }
  }, [apiBase, attemptId, resultBase, router, storageKey]);

  // Start / resume the attempt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setError({ reason: data.reason, message: data.error || "Unable to start quiz." });
          setLoading(false);
          return;
        }
        if (isPublicQuiz) ga4Event("quiz_start", { quiz_slug: slug, question_count: (data.questions || []).length });
        setAttemptId(data.attemptId);
        setQuestions(data.questions || []);
        setShowTimer(data.showTimer !== false);
        const saved: AnswerMap = {};
        const markedInit: Record<string, boolean> = {};
        for (const a of data.savedAnswers || []) {
          saved[a.question_id] = a.selected_option;
          if (a.marked_for_review) markedInit[a.question_id] = true;
        }
        // Merge local backup (in case of offline edits).
        try {
          const local = JSON.parse(localStorage.getItem(storageKey) || "{}");
          if (local.attemptId === data.attemptId && local.answers) Object.assign(saved, local.answers);
        } catch { /* ignore */ }
        setAnswers(saved);
        setMarked(markedInit);
        if (data.expiresAt) {
          const rem = Math.round((Date.parse(data.expiresAt) - Date.now()) / 1000);
          setRemaining(rem);
        }
        setLoading(false);
      } catch {
        if (!cancelled) { setError({ message: "Failed to load quiz." }); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, slug, storageKey]);

  // Mark the app "busy" while an attempt is live so a new-deploy auto-refresh
  // never reloads the student mid-quiz (it shows a gentle banner instead).
  useEffect(() => {
    if (!attemptId) return;
    setAppBusy(true);
    return () => setAppBusy(false);
  }, [attemptId]);

  // Timer tick.
  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) { doSubmit(true); return; }
    const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining, doSubmit]);

  // Warn before leaving.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!submittedRef.current && attemptId) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [attemptId]);

  const persistLocal = useCallback((next: AnswerMap) => {
    try { localStorage.setItem(storageKey, JSON.stringify({ attemptId, answers: next })); } catch { /* ignore */ }
  }, [attemptId, storageKey]);

  async function selectOption(qid: string, option: string | null) {
    const next = { ...answers, [qid]: option };
    setAnswers(next);
    persistLocal(next);
    try {
      await fetch(`${apiBase}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, questionId: qid, selectedOption: option, markedForReview: !!marked[qid] }),
      });
    } catch { /* saved locally; will retry on next action */ }
  }

  function toggleMark(qid: string) {
    const next = { ...marked, [qid]: !marked[qid] };
    setMarked(next);
    fetch(`${apiBase}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId, questionId: qid, selectedOption: answers[qid] ?? null, markedForReview: next[qid] }),
    }).catch(() => {});
  }

  if (loading) return <div className="container-narrow py-20 text-center text-muted">Loading test…</div>;

  if (error) {
    return (
      <div className="container-narrow py-16">
        <div className="card p-8 text-center">
          <h2 className="font-heading text-xl font-bold">Can&apos;t start this test</h2>
          <p className="mt-2 text-ink2">{error.message}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {error.reason === "lead" && <Link href={`/quizzes/${slug}/attempt`} className="btn btn-primary">Enter your details to continue</Link>}
            {error.reason === "login" && <Link href={`/login?next=/quizzes/${slug}`} className="btn btn-primary">Login to continue</Link>}
            {error.reason === "payment" && <Link href="/courses" className="btn btn-primary">View Courses</Link>}
            <Link href="/quizzes" className="btn btn-secondary">Back to Quizzes</Link>
          </div>
        </div>
      </div>
    );
  }

  const q = questions[current];
  const answeredCount = questions.filter((x) => answers[x.question_id]).length;

  function statusOf(qid: string): "answered" | "marked" | "unanswered" {
    if (marked[qid]) return "marked";
    if (answers[qid]) return "answered";
    return "unanswered";
  }

  const Palette = (
    <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-5">
      {questions.map((item, i) => {
        const st = statusOf(item.question_id);
        const color = st === "answered" ? "bg-success text-white" : st === "marked" ? "bg-warning text-white" : "bg-surface2 text-ink2";
        return (
          <button
            key={item.question_id}
            onClick={() => { setCurrent(i); setPaletteOpen(false); }}
            className={`h-9 rounded-lg text-sm font-semibold ${color} ${i === current ? "ring-2 ring-primary" : ""}`}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas pb-28">
      {/* Sticky timer/header */}
      <div className="frost sticky top-0 z-40 border-b border-line">
        <div className="container-wide flex items-center justify-between gap-3 py-3">
          <div className="text-sm font-semibold">Q {current + 1}/{questions.length} · <span className="text-success">{answeredCount} answered</span></div>
          {showTimer && remaining !== null && (
            <div className={`rounded-lg px-3 py-1.5 font-mono text-sm font-bold ${remaining < 60 ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"}`}>
              ⏱ {fmt(remaining)}
            </div>
          )}
          <button onClick={() => setConfirmOpen(true)} className="btn btn-primary px-4 py-1.5 text-sm">Submit</button>
        </div>
      </div>

      <div className="container-wide grid gap-6 py-6 lg:grid-cols-[1fr_280px]">
        {/* Question area */}
        <div>
          {q && (
            <div className="card p-5 sm:p-7">
              <div className="mb-3 flex items-center gap-2 text-xs text-muted">
                <span className="pill pill-blue">Q{current + 1}</span>
                {q.subject && <span>{q.subject}</span>}
                {q.topic && <span>· {q.topic}</span>}
                {q.difficulty && <span>· {q.difficulty}</span>}
              </div>
              {q.question_image && <img src={q.question_image} alt="" className="mb-4 max-h-72 rounded-xl object-contain" />}
              <div className="quiz-rich text-[15px] text-ink" dangerouslySetInnerHTML={{ __html: formatQuestionHtml(q.question_html) }} />
              <div className="mt-5 space-y-2.5">
                {q.options.map((opt) => {
                  const selected = answers[q.question_id] === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => selectOption(q.question_id, selected ? null : opt.key)}
                      className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-line hover:border-primary/40 hover:bg-surface"}`}
                    >
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${selected ? "bg-primary text-white" : "bg-surface2 text-ink2"}`}>{opt.key}</span>
                      <span className="quiz-rich flex-1 pt-0.5 text-[15px]" dangerouslySetInnerHTML={{ __html: opt.html }} />
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0} className="btn btn-secondary text-sm disabled:opacity-40">← Prev</button>
                <button onClick={() => selectOption(q.question_id, null)} className="btn btn-ghost text-sm">Clear</button>
                <button onClick={() => toggleMark(q.question_id)} className={`btn text-sm ${marked[q.question_id] ? "btn-primary" : "btn-secondary"}`}>{marked[q.question_id] ? "★ Marked" : "☆ Mark for review"}</button>
                <button onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))} disabled={current === questions.length - 1} className="btn btn-primary ml-auto text-sm">Save & Next →</button>
              </div>

              {current === questions.length - 1 && (
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={submitting}
                  className="btn btn-primary mt-4 w-full py-3 text-base disabled:opacity-50"
                >
                  {submitting ? "Submitting…" : "Submit Quiz"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Desktop palette */}
        <aside className="hidden lg:block">
          <div className="card sticky top-20 p-4">
            <p className="mb-3 text-sm font-semibold">Question Palette</p>
            {Palette}
            <div className="mt-4 space-y-1 text-xs text-muted">
              <p><span className="mr-2 inline-block h-3 w-3 rounded bg-success align-middle" /> Answered</p>
              <p><span className="mr-2 inline-block h-3 w-3 rounded bg-warning align-middle" /> Marked</p>
              <p><span className="mr-2 inline-block h-3 w-3 rounded bg-surface2 align-middle" /> Not answered</p>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile palette trigger */}
      <button onClick={() => setPaletteOpen(true)} className="btn btn-secondary fixed bottom-4 left-4 z-40 lg:hidden">☰ Palette</button>

      {/* Mobile palette bottom-sheet */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/30 lg:hidden" onClick={() => setPaletteOpen(false)}>
          <div className="w-full rounded-t-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><p className="font-semibold">Question Palette</p><button onClick={() => setPaletteOpen(false)} className="text-2xl leading-none text-muted">×</button></div>
            {Palette}
          </div>
        </div>
      )}

      {/* Submit confirm */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmOpen(false)}>
          <div className="card w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-lg font-bold">Submit test?</h3>
            <p className="mt-2 text-sm text-ink2">{answeredCount} of {questions.length} answered. You can&apos;t change answers after submitting.</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirmOpen(false)} className="btn btn-secondary flex-1">Keep going</button>
              <button onClick={() => doSubmit(false)} disabled={submitting} className="btn btn-primary flex-1">{submitting ? "Submitting…" : "Submit now"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
