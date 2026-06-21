"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import QuizForm from "@/components/admin/QuizForm";
import { LoadingBlock } from "@/components/admin/ui";
import type { Quiz } from "@/lib/types";

export default function EditQuizPage() {
  const params = useParams();
  const id = String(params.id);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/quizzes/${id}`)
      .then((r) => r.json())
      .then((d) => setQuiz(d.ok ? d.quiz : null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingBlock />;
  if (!quiz) return <div className="card p-10 text-center text-muted">Quiz not found.</div>;
  return <QuizForm quiz={quiz} />;
}
