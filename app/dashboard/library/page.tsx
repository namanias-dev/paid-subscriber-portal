"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import ContentCard from "@/components/dashboard/ContentCard";
import ExpiredView from "@/components/dashboard/ExpiredView";
import SearchBar from "@/components/ui/SearchBar";
import FilterTabs from "@/components/ui/FilterTabs";
import EmptyState from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { CONTENT_TABS } from "@/lib/contentMeta";
import { SUBJECTS } from "@/lib/config";

function LibraryInner() {
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

  const searchParams = useSearchParams();
  const initialSubject = searchParams.get("subject") || "all";

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [subject, setSubject] = useState(initialSubject);
  const [paper, setPaper] = useState("all");

  const papers = useMemo(() => {
    const set = new Set<string>();
    content.forEach((c) => c.paper && set.add(c.paper));
    return ["all", ...Array.from(set).sort()];
  }, [content]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return content.filter((c) => {
      if (tab !== "all" && c.type !== tab) return false;
      if (subject !== "all" && c.subject !== subject) return false;
      if (paper !== "all" && c.paper !== paper) return false;
      if (q) {
        const hay = `${c.title} ${c.description ?? ""} ${c.subject ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [content, query, tab, subject, paper]);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (expired) return <ExpiredView student={student} />;

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-2xl">Daily Feed &amp; Library</h1>
      <SearchBar value={query} onChange={setQuery} placeholder="Search content..." />
      <FilterTabs options={CONTENT_TABS} active={tab} onChange={setTab} />

      <div className="flex gap-2">
        <select value={subject} onChange={(e) => setSubject(e.target.value)} className="input">
          <option value="all">All subjects</option>
          {SUBJECTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={paper} onChange={(e) => setPaper(e.target.value)} className="input">
          {papers.map((p) => (
            <option key={p} value={p}>
              {p === "all" ? "All papers" : p}
            </option>
          ))}
        </select>
      </div>

      {filtered.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((item) => (
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
          icon="🔍"
          title="No matching content"
          subtitle="Try a different search or filter."
        />
      )}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="card h-40 animate-pulse" />}>
      <LibraryInner />
    </Suspense>
  );
}
