"use client";

import CourseForm from "@/components/admin/CourseForm";
import { useAdminData, LoadingBlock } from "@/components/admin/ui";
import type { Course } from "@/lib/types";

export default function EditCoursePage({ params }: { params: { id: string } }) {
  const { data, loading } = useAdminData<Course[]>("/api/admin/courses", "courses");
  if (loading) return <LoadingBlock />;
  const course = (data || []).find((c) => c.id === params.id);
  if (!course) return <p className="text-ink2">Course not found.</p>;
  return <CourseForm course={course} />;
}
