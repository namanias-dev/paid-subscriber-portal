/** Staff snapshot metrics for Access at Risk (section 10). */
export interface AccessRiskSummaryData {
  blockedCount: number;
  graceCount: number;
  activeExtensions: number;
  outstandingByTier: Record<string, number>;
  remindersSentToday: number;
  totalOutstanding: number;
}
