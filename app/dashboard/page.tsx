"use client";

import { useMemo } from "react";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import WelcomeBar from "@/components/dashboard/WelcomeBar";
import SubjectChips from "@/components/dashboard/SubjectChips";
import ContentCard from "@/components/dashboard/ContentCard";
import ExpiredView from "@/components/dashboard/ExpiredView";
import EmptyState from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { todayISODate } from "@/lib/dates";

export default function DashboardHome() {
  const {
    loading,
    student,
    content,
    expired,
    bookmarkIds,
    completedIds,
    toggleBookmark,
    markComplete,
    recordOpen,
  } = useDashboard();

  const today = todayISODate();

  const todayCA = useMemo(
    () =>
      content.find((c) => c.type === "current_affairs" && c.date === today) ||
      content.find((c) => c.type === "current_affairs"),
    [content, today]
  );
  const todayMCQ = useMemo(() => content.find((c) => c.type === "mcq"), [content]);
  const liveClass = useMemo(
    () => content.find((c) => c.type === "live_link"),
    [content]
  );
  const recent = useMemo(
    () => content.filter((c) => completedIds.has(c.id)).slice(0, 4),
    [content, completedIds]
  );

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

      <section id="live">
        <h3 className="mb-3 font-heading text-lg text-text">Today&apos;s Content</h3>
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
          <EmptyState
            icon="🌅"
            title="No content for today yet"
            subtitle="Naman Sir's team uploads daily — check back soon."
          />
        )}
      </section>

      <section>
        <h3 className="mb-3 font-heading text-lg text-text">Browse by Subject</h3>
        <SubjectChips />
      </section>

      {recent.length > 0 && (
        <section>
          <h3 className="mb-3 font-heading text-lg text-text">Continue / Recent</h3>
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
