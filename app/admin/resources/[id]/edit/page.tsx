"use client";

import { useAdminData, LoadingBlock } from "@/components/admin/ui";
import ResourceForm from "@/components/admin/ResourceForm";
import type { Resource } from "@/lib/types";

export default function EditResourcePage({ params }: { params: { id: string } }) {
  const { data, loading } = useAdminData<Resource[]>("/api/admin/resources", "resources");
  if (loading) return <LoadingBlock />;
  const resource = (data || []).find((r) => r.id === params.id);
  if (!resource) return <p className="text-ink2">Resource not found.</p>;
  return <ResourceForm resource={resource} />;
}
