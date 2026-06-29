"use client";

import { FolderOpen, ChevronRight, CheckCircle2 } from "lucide-react";
import { formatISTDate } from "@/lib/dates";

/**
 * Premium subject folder tile for the Class Hub. White card, navy heading, gold
 * accents — shows the subject, lecture count, latest lecture date and completed
 * progress. Used by Recordings + Notes when multiple subjects exist.
 */

const SUBJECT_EMOJI: Record<string, string> = {
  Polity: "⚖️", History: "🏛️", Geography: "🌍", Economy: "📈", Environment: "🌿",
  "S&T": "🔬", "Science & Tech": "🔬", IR: "🌐", "Current Affairs": "📰", CSAT: "🧮",
  Ethics: "🧭", "Public Administration": "🏢", Optional: "📚", Orientation: "🎬",
  Starter: "🎬", General: "🗂️",
};

export default function SubjectFolderCard({
  subject,
  count,
  latestDate,
  completedCount = 0,
  onClick,
}: {
  subject: string;
  count: number;
  latestDate?: string | null;
  completedCount?: number;
  onClick: () => void;
}) {
  const pct = count > 0 ? Math.round((completedCount / count) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="ca-focus group flex h-full w-full flex-col rounded-2xl border border-line bg-white p-4 text-left shadow-soft-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(212,175,55,0.55)] hover:shadow-soft motion-reduce:transform-none motion-reduce:transition-none"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#0b1437] text-lg text-[var(--ca-gold)]">
          <span aria-hidden>{SUBJECT_EMOJI[subject] || <FolderOpen size={18} />}</span>
        </span>
        <ChevronRight size={18} className="mt-1 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--ca-gold)]" />
      </div>

      <p className="mt-3 font-heading text-base font-bold text-[#0b1437]">{subject}</p>
      <p className="mt-0.5 text-xs text-muted">
        {count} {count === 1 ? "lecture" : "lectures"}
        {latestDate && <> · latest {formatISTDate(latestDate)}</>}
      </p>

      {completedCount > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] font-semibold text-ink2">
            <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-success" /> {completedCount}/{count} done</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface2">
            <span className="block h-full rounded-full bg-[var(--ca-gold)]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </button>
  );
}
