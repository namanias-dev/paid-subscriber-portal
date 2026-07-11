"use client";

import { useState } from "react";
import { Card, RiskPill } from "@/components/kit";

type PlanStep = { tool: string; risk: "green" | "amber" | "red"; note: string; executable: boolean };

const SUGGESTIONS = [
  "What needs my attention today?",
  "Show stuck revenue.",
  "Which leads are most likely to enroll?",
  "Show paid students who have not logged in.",
  "Prepare overdue installment reminders.",
];

/**
 * CEO command interface. Deterministic intent routing — NO LLM, NO execution. It produces a
 * structured PLAN (a preview of which read-only tools would run). Any amber/red step is shown as
 * disabled, honoring the read-only first release.
 */
export default function CommandBox() {
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState<PlanStep[] | null>(null);

  function build(text: string) {
    const s = text.toLowerCase();
    const steps: PlanStep[] = [];
    if (/attention|today|brief/.test(s)) steps.push({ tool: "get_ceo_daily_brief", risk: "green", note: "Summarize today's revenue attention items.", executable: true });
    if (/revenue|stuck|outstanding|overdue/.test(s)) steps.push({ tool: "get_revenue_summary", risk: "green", note: "Reconciled revenue + overdue buckets.", executable: true });
    if (/overdue/.test(s)) steps.push({ tool: "get_outstanding_installments", risk: "green", note: "List overdue installments.", executable: true });
    if (/remind|campaign|sms/.test(s)) steps.push({ tool: "prepare_sms_campaign", risk: "amber", note: "Draft reminders — DISABLED (campaigns off).", executable: false });
    if (/lead|enroll/.test(s)) steps.push({ tool: "get_hot_leads", risk: "green", note: "Prioritize leads by signals.", executable: true });
    if (/logged in|inactive|paid students/.test(s)) steps.push({ tool: "get_student_journey", risk: "green", note: "Paid-but-inactive students.", executable: true });
    if (/abandon/.test(s)) steps.push({ tool: "get_abandoned_checkouts", risk: "green", note: "Abandoned checkout value.", executable: true });
    if (steps.length === 0) steps.push({ tool: "get_ceo_daily_brief", risk: "green", note: "Default: today's brief.", executable: true });
    setPlan(steps);
  }

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) build(q);
        }}
        className="flex gap-2"
      >
        <input className="aiva-input" placeholder="Ask AIVA… (e.g. Show stuck revenue)" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="aiva-btn-primary" type="submit">Plan</button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="aiva-chip border-line text-muted hover:text-white" onClick={() => { setQ(s); build(s); }}>
            {s}
          </button>
        ))}
      </div>

      {plan ? (
        <div className="mt-4">
          <div className="aiva-label mb-2">Structured plan (preview — nothing is executed)</div>
          <ol className="space-y-2">
            {plan.map((step, i) => (
              <li key={i} className="flex items-center justify-between rounded-xl border border-line bg-navy-700/30 px-3 py-2">
                <div>
                  <span className="font-mono text-sm text-white">{step.tool}</span>
                  <div className="text-xs text-muted">{step.note}</div>
                </div>
                <div className="flex items-center gap-2">
                  <RiskPill risk={step.risk} />
                  <span className={`aiva-chip ${step.executable ? "border-success/50 text-success" : "border-warning/50 text-warning"}`}>
                    {step.executable ? "read-only" : "disabled"}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}
