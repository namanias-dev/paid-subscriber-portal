"use client";

import { useMemo } from "react";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import ExpiredView from "@/components/dashboard/ExpiredView";
import ContentCard from "@/components/dashboard/ContentCard";
import EmptyState from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import type { ContentType } from "@/lib/types";

export default function ContentSection({
  title,
  types,
  emptyIcon = "📭",
  emptyText = "Nothing here yet",
}: {
  title: string;
  types: ContentType[];
  emptyIcon?: string;
  emptyText?: string;
}) {
  const { loading, expired, student, content, bookmarkIds, completedIds, toggleBookmark, markComplete, recordOpen } =
    useDashboard();

  const items = useMemo(() => content.filter((c) => types.includes(c.type)), [content, types]);

  if (loading)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  if (expired) return <ExpiredView student={student} />;

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl">{title}</h1>
      {items.length === 0 ? (
        <EmptyState icon={emptyIcon} title={emptyText} subtitle="Naman Sir's team uploads regularly — check back soon." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
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
      )}
    </div>
  );
}
