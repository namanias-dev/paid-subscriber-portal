"use client";

import { useAdminData, LoadingBlock } from "@/components/admin/ui";
import CaArticleForm from "@/components/admin/CaArticleForm";
import type { CaArticle } from "@/lib/types";

export default function EditCaArticlePage({ params }: { params: { id: string } }) {
  const { data, loading } = useAdminData<CaArticle[]>("/api/admin/current-affairs", "articles");
  if (loading) return <LoadingBlock />;
  const article = (data || []).find((a) => a.id === params.id);
  if (!article) return <p className="text-ink2">Article not found.</p>;
  return <CaArticleForm article={article} />;
}
