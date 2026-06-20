"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { ContentItem, Student, Enrollment, Course } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";

interface DashboardState {
  loading: boolean;
  student: Student | null;
  content: ContentItem[];
  enrollments: Enrollment[];
  courses: Course[];
  bookmarkIds: Set<string>;
  completedIds: Set<string>;
  expired: boolean;
  toggleBookmark: (id: string) => void;
  markComplete: (id: string) => void;
  recordOpen: (id: string) => void;
  updateProfile: (patch: { target_year?: number | null; optional_subject?: string | null }) => Promise<void>;
  refresh: () => void;
}

const Ctx = createContext<DashboardState | null>(null);

export function useDashboard() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardProvider");
  return ctx;
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<Student | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [expired, setExpired] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/student/content", { cache: "no-store" });
      const data = await res.json();
      if (res.status === 401) {
        router.replace("/");
        return;
      }
      if (data.student) setStudent(data.student);
      if (data.enrollments) setEnrollments(data.enrollments);
      if (data.courses) setCourses(data.courses);
      if (data.expired) {
        setExpired(true);
        setContent([]);
        return;
      }
      setExpired(false);
      setContent(data.content || []);
      setBookmarkIds(
        new Set((data.bookmarks || []).map((b: { content_id: string }) => b.content_id))
      );
      setCompletedIds(
        new Set(
          (data.progress || [])
            .filter((p: { completed: boolean }) => p.completed)
            .map((p: { content_id: string }) => p.content_id)
        )
      );
    } catch {
      toast("Couldn't load your dashboard. Retry.", "error");
    } finally {
      setLoading(false);
    }
  }, [router, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleBookmark = useCallback(
    async (id: string) => {
      const isOn = bookmarkIds.has(id);
      setBookmarkIds((prev) => {
        const next = new Set(prev);
        if (isOn) next.delete(id);
        else next.add(id);
        return next;
      });
      try {
        await fetch("/api/student/bookmark", {
          method: isOn ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content_id: id }),
        });
        toast(isOn ? "Removed bookmark" : "Bookmarked ★", "success");
      } catch {
        toast("Bookmark failed", "error");
      }
    },
    [bookmarkIds, toast]
  );

  const markComplete = useCallback(
    async (id: string) => {
      const isDone = completedIds.has(id);
      setCompletedIds((prev) => {
        const next = new Set(prev);
        if (isDone) next.delete(id);
        else next.add(id);
        return next;
      });
      try {
        await fetch("/api/student/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content_id: id, completed: !isDone }),
        });
      } catch {
        toast("Couldn't update progress", "error");
      }
    },
    [completedIds, toast]
  );

  const recordOpen = useCallback((id: string) => {
    setCompletedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      fetch("/api/student/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_id: id, completed: true }),
      }).catch(() => {});
      return next;
    });
  }, []);

  const updateProfile = useCallback(
    async (patch: { target_year?: number | null; optional_subject?: string | null }) => {
      try {
        const res = await fetch("/api/student/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (data.ok) {
          setStudent(data.student);
          toast("Profile updated", "success");
        } else {
          toast(data.error || "Update failed", "error");
        }
      } catch {
        toast("Update failed", "error");
      }
    },
    [toast]
  );

  return (
    <Ctx.Provider
      value={{
        loading,
        student,
        content,
        enrollments,
        courses,
        bookmarkIds,
        completedIds,
        expired,
        toggleBookmark,
        markComplete,
        recordOpen,
        updateProfile,
        refresh: load,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
