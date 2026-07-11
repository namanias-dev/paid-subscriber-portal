import { getRevenueTower, type RevenueTower } from "./tower";

/**
 * CEO Daily Brief — a read-only, deterministic summary of what needs Aman's attention today.
 * Built entirely from reconciled revenue truth. No LLM, no fabricated numbers.
 */

export type Severity = "high" | "medium" | "low";

export type AttentionItem = {
  id: string;
  severity: Severity;
  domain: string;
  title: string;
  detail: string;
  metric?: number;
};

export type DailyBrief = {
  greetingName: string;
  dateLabel: string;
  tower: RevenueTower;
  attention: AttentionItem[];
  generatedAt: string;
};

export async function getDailyBrief(greetingName = "Aman"): Promise<DailyBrief> {
  const tower = await getRevenueTower();
  const attention: AttentionItem[] = [];

  if (tower.paidWithoutActiveEnrollment > 0) {
    attention.push({
      id: "paid-no-access",
      severity: "high",
      domain: "revenue",
      title: "Paid without active enrollment",
      detail: `${tower.paidWithoutActiveEnrollment} phone(s) with paid course payments have no active enrollment. Review for access/reconciliation.`,
      metric: tower.paidWithoutActiveEnrollment,
    });
  }

  if (tower.overdue8plus.amount > 0) {
    attention.push({
      id: "overdue-8plus",
      severity: "high",
      domain: "revenue",
      title: "Installments overdue 8+ days",
      detail: `${tower.overdue8plus.count} installment(s) worth ${inr(tower.overdue8plus.amount)} are more than a week overdue.`,
      metric: tower.overdue8plus.amount,
    });
  }

  if (tower.overdue4_7.amount > 0) {
    attention.push({
      id: "overdue-4-7",
      severity: "medium",
      domain: "revenue",
      title: "Installments overdue 4–7 days",
      detail: `${tower.overdue4_7.count} installment(s) worth ${inr(tower.overdue4_7.amount)} overdue 4–7 days.`,
      metric: tower.overdue4_7.amount,
    });
  }

  if (tower.proofsPending > 0) {
    attention.push({
      id: "proof-queue",
      severity: "medium",
      domain: "operations",
      title: "Payment proofs awaiting review",
      detail: `${tower.proofsPending} uploaded proof(s) are waiting for staff verification.`,
      metric: tower.proofsPending,
    });
  }

  if (tower.abandoned.amount > 0) {
    attention.push({
      id: "abandoned",
      severity: "medium",
      domain: "marketing",
      title: "Abandoned checkouts",
      detail: `${tower.abandoned.count} abandoned checkout(s) worth ${inr(tower.abandoned.amount)} could be recovered.`,
      metric: tower.abandoned.amount,
    });
  }

  if (tower.dueToday.amount > 0) {
    attention.push({
      id: "due-today",
      severity: "low",
      domain: "revenue",
      title: "Due today",
      detail: `${tower.dueToday.count} installment(s) worth ${inr(tower.dueToday.amount)} are due today.`,
      metric: tower.dueToday.amount,
    });
  }

  if (attention.length === 0) {
    attention.push({
      id: "all-clear",
      severity: "low",
      domain: "revenue",
      title: "Nothing urgent",
      detail: "No overdue installments, proof backlog, or access anomalies detected right now.",
    });
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  attention.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    greetingName,
    dateLabel: new Date().toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }),
    tower,
    attention,
    generatedAt: new Date().toISOString(),
  };
}

export function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
}
