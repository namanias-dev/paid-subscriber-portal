"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Lock, CheckCircle2 } from "lucide-react";
import type { Quiz } from "@/lib/types";
import type { QuizAttemptStatus } from "@/lib/quizAttemptStatus";
import QuizAttemptActions from "./QuizAttemptActions";

export type QuizStatus = "entitled" | "locked";

function canRetake(quiz: Quiz, attempt: QuizAttemptStatus): boolean {
  if (quiz.max_attempts && attempt.attemptCount >= quiz.max_attempts && quiz.attempt_settings?.retry_allowed === false) {
    return false;
  }
  return true;
}

function QuizCard({ quiz, status, attempt }: { quiz: Quiz; status?: QuizStatus; attempt?: QuizAttemptStatus }) {
  const paid = quiz.requires_payment || status === "locked" || status === "entitled";
  return (
    <div className="card group flex flex-col p-5 transition hover:shadow-lg">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {attempt ? (
          <span className="pill inline-flex items-center gap-1 bg-success/10 text-success"><CheckCircle2 size={12} /> Attempted</span>
        ) : status === "entitled" ? (
          <span className="pill inline-flex items-center gap-1 bg-success/10 text-success"><CheckCircle2 size={12} /> Unlocked</span>
        ) : status === "locked" ? (
          <span className="pill inline-flex items-center gap-1 bg-amber-100 text-amber-700"><Lock size={11} /> Locked</span>
        ) : (
          <span className={`pill ${paid ? "pill-amber" : "pill-green"}`}>{paid ? "Paid" : "Free"}</span>
        )}
        {quiz.subject && <span className="pill pill-blue">{quiz.subject}</span>}
      </div>
      <Link href={`/quizzes/${quiz.slug}`} className="block">
        <h3 className="font-heading text-base font-bold leading-snug transition group-hover:text-primary">{quiz.title}</h3>
      </Link>
      {quiz.topic && <p className="mt-1 text-sm text-muted">{quiz.topic}</p>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {quiz.time_limit_minutes ? <span>⏱ {quiz.time_limit_minutes} min</span> : <span>⏱ Untimed</span>}
        <span>★ {quiz.difficulty}</span>
        {quiz.quiz_date && <span>📅 {new Date(quiz.quiz_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
      </div>
      <div className="mt-4">
        {attempt ? (
          <QuizAttemptActions
            slug={quiz.slug}
            status={attempt}
            retakeHref={status !== "locked" && canRetake(quiz, attempt) ? `/quizzes/${quiz.slug}/attempt` : null}
          />
        ) : (
          <Link href={`/quizzes/${quiz.slug}`} className={`btn w-full text-sm ${status === "locked" ? "btn-secondary" : "btn-primary"}`}>
            {status === "locked" ? "Unlock →" : "Start Test →"}
          </Link>
        )}
      </div>
    </div>
  );
}

export default function QuizBrowser({ quizzes, statuses, attempts }: { quizzes: Quiz[]; statuses?: Record<string, QuizStatus>; attempts?: Record<string, QuizAttemptStatus> }) {
  const [subject, setSubject] = useState("all");
  const [q, setQ] = useState("");

  const subjects = useMemo(() => {
    const s = new Set<string>();
    quizzes.forEach((x) => x.subject && s.add(x.subject));
    return ["all", ...[...s].sort()];
  }, [quizzes]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return quizzes.filter((x) => {
      if (subject !== "all" && x.subject !== subject) return false;
      if (query && !x.title.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [quizzes, subject, q]);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input className="input sm:max-w-xs" placeholder="Search quizzes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {subjects.map((s) => (
            <button
              key={s}
              onClick={() => setSubject(s)}
              className={`whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition ${subject === s ? "border-primary bg-primary text-white" : "border-line text-ink2 hover:bg-surface"}`}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center text-muted">No quizzes found. Check back soon!</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((quiz) => <QuizCard key={quiz.id} quiz={quiz} status={statuses?.[quiz.id]} attempt={attempts?.[quiz.id]} />)}
        </div>
      )}
    </div>
  );
}
