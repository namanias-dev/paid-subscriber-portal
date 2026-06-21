import type { Metadata } from "next";
import ResultPrint from "@/components/public/quiz/ResultPrint";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Quiz Result — Naman IAS Academy" };

export default function QuizPrintPage({ params }: { params: { attemptId: string } }) {
  return <ResultPrint attemptId={params.attemptId} />;
}
