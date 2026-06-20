"use client";

import { useMemo } from "react";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import ContentCard from "@/components/dashboard/ContentCard";
import ExpiredView from "@/components/dashboard/ExpiredView";
import EmptyState from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";

export default function BookmarksPage() {
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

  const saved = useMemo(
    () => content.filter((c) => bookmarkIds.has(c.id)),
    [content, bookmarkIds]
  );

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (expired) return <ExpiredView student={student} />;

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-2xl">Saved Items</h1>
      {saved.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {saved.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              bookmarked
              completed={completedIds.has(item.id)}
              onBookmark={() => toggleBookmark(item.id)}
              onComplete={() => markComplete(item.id)}
              onOpen={() => recordOpen(item.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="⭐"
          title="No bookmarks yet"
          subtitle="Tap the star on any content to save it here for quick access."
        />
      )}
    </div>
  );
}
