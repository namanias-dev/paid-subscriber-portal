"use client";

import { useParams } from "next/navigation";
import AttemptEngine from "@/components/public/quiz/AttemptEngine";

export default function StudentAttemptPage() {
  const params = useParams();
  const slug = String(params.slug);
  return (
    <AttemptEngine
      apiBase="/api/public/quiz"
      slug={slug}
      resultBase={`/dashboard/quizzes/${slug}/result`}
    />
  );
}
