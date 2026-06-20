"use client";

import WebinarForm from "@/components/admin/WebinarForm";
import { useAdminData, LoadingBlock } from "@/components/admin/ui";
import type { Webinar } from "@/lib/types";

export default function EditWebinarPage({ params }: { params: { id: string } }) {
  const { data, loading } = useAdminData<Webinar[]>("/api/admin/webinars", "webinars");
  if (loading) return <LoadingBlock />;
  const webinar = (data || []).find((w) => w.id === params.id);
  if (!webinar) return <p className="text-ink2">Webinar not found.</p>;
  return <WebinarForm webinar={webinar} />;
}
