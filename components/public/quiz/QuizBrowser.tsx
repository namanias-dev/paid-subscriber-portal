"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Quiz } from "@/lib/types";

function QuizCard({ quiz }: { quiz: Quiz }) {
  return (
    <Link href={`/quizzes/${quiz.slug}`} className="card group flex flex-col p-5 transition hover:shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <span className={`pill ${quiz.requires_payment ? "pill-amber" : "pill-green"}`}>{quiz.requires_payment ? "Paid" : "Free"}</span>
        {quiz.subject && <span className="pill pill-blue">{quiz.subject}</span>}
      </div>
      <h3 className="font-heading text-base font-bold leading-snug group-hover:text-primary">{quiz.title}</h3>
      {quiz.topic && <p className="mt-1 text-sm text-muted">{quiz.topic}</p>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {quiz.time_limit_minutes ? <span>⏱ {quiz.time_limit_minutes} min</span> : <span>⏱ Untimed</span>}
        <span>★ {quiz.difficulty}</span>
        {quiz.quiz_date && <span>📅 {new Date(quiz.quiz_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
      </div>
      <span className="btn btn-primary mt-4 w-full text-sm">Start Test →</span>
    </Link>
  );
}

export default function QuizBrowser({ quizzes }: { quizzes: Quiz[] }) {
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
          {filtered.map((quiz) => <QuizCard key={quiz.id} quiz={quiz} />)}
        </div>
      )}
    </div>
  );
}
