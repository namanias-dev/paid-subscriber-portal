"use client";

import Link from "next/link";

/**
 * True profile anchor for student names in admin lists.
 * Keyboard-focusable, cmd/ctrl-click opens a new tab, stopPropagation so row
 * selection / expand handlers elsewhere on the row stay intact.
 */
export default function StudentNameLink({
  studentId,
  enrollmentId,
  name,
  className = "",
}: {
  studentId: string | null | undefined;
  enrollmentId?: string | null;
  name: string | null | undefined;
  className?: string;
}) {
  const label = (name || "—").trim() || "—";
  if (!studentId) {
    return <span className={`font-medium text-ink ${className}`}>{label}</span>;
  }
  const href = enrollmentId
    ? `/admin/students/${encodeURIComponent(studentId)}?enrollmentId=${encodeURIComponent(enrollmentId)}`
    : `/admin/students/${encodeURIComponent(studentId)}`;
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={`font-medium text-ink underline-offset-2 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${className}`}
    >
      {label}
    </Link>
  );
}
