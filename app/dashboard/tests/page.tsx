"use client";

import ContentSection from "@/components/dashboard/ContentSection";

export default function TestsPage() {
  return <ContentSection title="Test Series & Answer Writing" types={["test_series", "answer_writing", "mcq"]} emptyIcon="🧪" emptyText="No tests available yet" />;
}
