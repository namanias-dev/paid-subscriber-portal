"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import QuestionForm from "@/components/admin/QuestionForm";
import { LoadingBlock } from "@/components/admin/ui";
import type { Question } from "@/lib/types";

export default function EditQuestionPage() {
  const params = useParams();
  const id = String(params.id);
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/questions/${id}`)
      .then((r) => r.json())
      .then((d) => setQuestion(d.ok ? d.question : null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingBlock />;
  if (!question) return <div className="card p-10 text-center text-muted">Question not found.</div>;
  return <QuestionForm question={question} />;
}
