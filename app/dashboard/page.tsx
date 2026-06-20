"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import WelcomeBar from "@/components/dashboard/WelcomeBar";
import SubjectChips from "@/components/dashboard/SubjectChips";
import ContentCard from "@/components/dashboard/ContentCard";
import ExpiredView from "@/components/dashboard/ExpiredView";
import EmptyState from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { todayISODate } from "@/lib/dates";

const QUICK = [
  { href: "/dashboard/my-courses", icon: "🎓", label: "My Courses" },
  { href: "/dashboard/live", icon: "🔴", label: "Live Classes" },
  { href: "/dashboard/tests", icon: "🧪", label: "Test Series" },
  { href: "/dashboard/material", icon: "📚", label: "Study Material" },
  { href: "/dashboard/mentorship", icon: "🤝", label: "Mentorship" },
  { href: "/dashboard/fees", icon: "💳", label: "My Fees" },
];

export default function DashboardHome() {
  const { loading, student, content, expired, bookmarkIds, completedIds, toggleBookmark, markComplete, recordOpen } =
    useDashboard();

  const today = todayISODate();
  const todayCA = useMemo(
    () => content.find((c) => c.type === "current_affairs" && c.date === today) || content.find((c) => c.type === "current_affairs"),
    [content, today]
  );
  const todayMCQ = useMemo(() => content.find((c) => c.type === "mcq"), [content]);
  const liveClass = useMemo(() => content.find((c) => c.type === "live_link"), [content]);
  const recent = useMemo(() => content.filter((c) => completedIds.has(c.id)).slice(0, 4), [content, completedIds]);
  const todays = [todayCA, todayMCQ, liveClass].filter(Boolean) as typeof content;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="card h-28 animate-pulse" />
        <div className="grid gap-3 sm:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (expired) return <ExpiredView student={student} />;

  return (
    <div className="space-y-6">
      {student && <WelcomeBar student={student} />}

      <section>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {QUICK.map((q) => (
            <Link key={q.href} href={q.href} className="card card-hover flex flex-col items-center gap-1.5 p-4 text-center">
              <span className="text-2xl">{q.icon}</span>
              <span className="text-xs font-medium text-ink2">{q.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section id="live">
        <h3 className="mb-3 font-heading text-lg">Today&apos;s Content</h3>
        {todays.length ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {todays.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                bookmarked={bookmarkIds.has(item.id)}
                completed={completedIds.has(item.id)}
                onBookmark={() => toggleBookmark(item.id)}
                onComplete={() => markComplete(item.id)}
                onOpen={() => recordOpen(item.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon="🌅" title="No content for today yet" subtitle="Naman Sir's team uploads daily — check back soon." />
        )}
      </section>

      <section>
        <h3 className="mb-3 font-heading text-lg">Browse by Subject</h3>
        <SubjectChips />
      </section>

      {recent.length > 0 && (
        <section>
          <h3 className="mb-3 font-heading text-lg">Continue / Recent</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {recent.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                bookmarked={bookmarkIds.has(item.id)}
                completed={completedIds.has(item.id)}
                onBookmark={() => toggleBookmark(item.id)}
                onComplete={() => markComplete(item.id)}
                onOpen={() => recordOpen(item.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
