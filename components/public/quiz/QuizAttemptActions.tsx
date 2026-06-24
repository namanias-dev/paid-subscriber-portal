import Link from "next/link";
import { CheckCircle2, FileText, Download, RotateCcw } from "lucide-react";
import type { QuizAttemptStatus } from "@/lib/quizAttemptStatus";

/**
 * Shared "✓ Attempted + score + report/PDF" block. Reused on the /quizzes cards,
 * the quiz detail CTA, and the Class Hub Tests section so the experience is
 * identical everywhere. Server-safe (no hooks). View report + Download PDF point
 * at the EXISTING free-quiz result + print routes (rebuilt from stored data).
 */
export default function QuizAttemptActions({
  slug,
  status,
  retakeHref,
  className = "",
}: {
  slug: string;
  status: QuizAttemptStatus;
  /** When provided, shows a "Re-attempt" action (only when retakes are allowed). */
  retakeHref?: string | null;
  className?: string;
}) {
  return (
    <div className={`w-full ${className}`}>
      <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-bold text-success">
        <CheckCircle2 size={13} aria-hidden="true" /> Attempted — {status.score}/{status.maxScore}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/quizzes/${slug}/result/${status.attemptId}`} className="btn btn-secondary flex-1 justify-center text-sm">
          <FileText size={14} aria-hidden="true" /> View report
        </Link>
        <a
          href={`/quiz-print/${status.attemptId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary flex-1 justify-center text-sm"
        >
          <Download size={14} aria-hidden="true" /> Download PDF
        </a>
        {retakeHref && (
          <Link href={retakeHref} className="btn btn-ghost text-sm">
            <RotateCcw size={14} aria-hidden="true" /> Re-attempt
          </Link>
        )}
      </div>
    </div>
  );
}
