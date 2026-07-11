import { Card, SectionTitle } from "@/components/kit";
import { flags } from "@/lib/flags";

export const dynamic = "force-dynamic";

export default function LearningPage() {
  const layers = [
    { t: "Decision memory", d: "Records recommendations, approvals/rejections, edits, final audience, copy, timing and result." },
    { t: "Preference learning", d: "Infers stable operating preferences only after repeated evidence. Any inferred policy is visible and reversible." },
    { t: "Outcome learning", d: "Measures registration, payment, recovery, replies, opt-outs, refunds. Uses control groups; never optimizes only for clicks." },
    { t: "Predictive models", d: "Deterministic scoring first; logistic/GBM/bandits later with calibration and drift monitoring. No unvalidated model performs Red actions." },
  ];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-white">Learning Engine</h1>
        <p className="text-sm text-muted">Four controlled learning layers. No uncontrolled reinforcement learning.</p>
      </div>
      <Card className={flags.learning ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5"}>
        <p className={`text-sm ${flags.learning ? "text-success" : "text-warning"}`}>
          {flags.learning
            ? "AIVA_LEARNING_ENABLED=true — decision memory is being recorded."
            : "🔒 AIVA_LEARNING_ENABLED=false in this read-only release. Nothing is written yet."}
        </p>
      </Card>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {layers.map((l) => (
          <Card key={l.t}>
            <SectionTitle>{l.t}</SectionTitle>
            <p className="text-sm text-muted">{l.d}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
