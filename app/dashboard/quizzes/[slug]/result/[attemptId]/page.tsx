"use client";

import { useParams } from "next/navigation";
import ResultView from "@/components/public/quiz/ResultView";

export default function StudentResultPage() {
  const params = useParams();
  const slug = String(params.slug);
  const attemptId = String(params.attemptId);
  return (
    <ResultView
      apiBase="/api/public/quiz"
      attemptId={attemptId}
      retakeHref={`/dashboard/quizzes/${slug}/attempt`}
      dashboardHref="/dashboard/quizzes"
      printHref={`/quiz-print/${attemptId}`}
    />
  );
}
