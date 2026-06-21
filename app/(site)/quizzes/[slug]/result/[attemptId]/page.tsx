import type { Metadata } from "next";
import { getSiteSettings } from "@/lib/dataProvider";
import { normalizeIndianMobile } from "@/lib/phone";
import ResultView from "@/components/public/quiz/ResultView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PublicQuizResultPage({ params }: { params: { slug: string; attemptId: string } }) {
  const settings = await getSiteSettings();
  const waRaw = settings?.brand?.whatsapp || settings?.brand?.support_phone || null;
  const wa = waRaw ? normalizeIndianMobile(waRaw) : null;
  const whatsappHref = wa?.ok ? `https://wa.me/${wa.wa}` : undefined;

  return (
    <ResultView
      apiBase="/api/public/quiz"
      attemptId={params.attemptId}
      retakeHref={`/quizzes/${params.slug}/attempt`}
      printHref={`/quiz-print/${params.attemptId}`}
      whatsappHref={whatsappHref}
    />
  );
}
