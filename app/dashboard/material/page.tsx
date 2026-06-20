"use client";

import ContentSection from "@/components/dashboard/ContentSection";

export default function MaterialPage() {
  return <ContentSection title="Study Material" types={["booklet", "pyq", "notes", "maps"]} emptyIcon="📚" emptyText="No study material yet" />;
}
