"use client";

import Link from "next/link";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import ExpiredView from "@/components/dashboard/ExpiredView";
import { CardSkeleton } from "@/components/ui/Skeleton";

export default function MentorshipPage() {
  const { loading, expired, student, enrollments, courses } = useDashboard();

  if (loading) return <CardSkeleton />;
  if (expired) return <ExpiredView student={student} />;

  const mentorshipCourse = courses.find((c) => c.category === "Mentorship");
  const enrolled = enrollments.some((e) => {
    const c = courses.find((x) => x.id === e.course_id);
    return c?.category === "Mentorship";
  });

  if (!enrolled) {
    return (
      <div className="space-y-5">
        <h1 className="font-heading text-2xl">Mentorship</h1>
        <div className="card p-8 text-center">
          <div className="mb-3 text-4xl">🔒</div>
          <h3 className="text-lg">Unlock 1:1 mentorship with Naman Sir</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink2">
            Personal study plans, weekly reviews, and direct guidance to fast-track your preparation.
          </p>
          {mentorshipCourse && (
            <Link href={`/courses/${mentorshipCourse.slug}`} className="btn btn-primary mx-auto mt-5">
              Explore Mentorship →
            </Link>
          )}
        </div>
      </div>
    );
  }

  const sessions = [
    { title: "Weekly Review — Strategy & Progress", when: "This Saturday, 6:00 PM", note: "Bring your weekly answer sheets." },
    { title: "Optional Subject Deep-Dive", when: "Next Tuesday, 7:30 PM", note: "Focus on case-based answers." },
  ];

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl">Mentorship</h1>
      <div className="card p-5">
        <p className="font-semibold text-success">✓ You&apos;re enrolled in personal mentorship</p>
        <p className="mt-1 text-sm text-ink2">Your mentor: Naman Sir</p>
      </div>
      <h3 className="font-heading text-lg">Upcoming sessions</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {sessions.map((s) => (
          <div key={s.title} className="card p-5">
            <h4 className="text-base">{s.title}</h4>
            <p className="mt-1 text-sm text-primary">{s.when}</p>
            <p className="mt-2 text-sm text-ink2">{s.note}</p>
            <button className="btn btn-primary mt-4 w-full text-sm">Join Session</button>
          </div>
        ))}
      </div>
    </div>
  );
}
