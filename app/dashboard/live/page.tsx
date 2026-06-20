"use client";

import ContentSection from "@/components/dashboard/ContentSection";

export default function LivePage() {
  return <ContentSection title="Live Classes & Recordings" types={["live_link", "recording"]} emptyIcon="🔴" emptyText="No live classes scheduled" />;
}
