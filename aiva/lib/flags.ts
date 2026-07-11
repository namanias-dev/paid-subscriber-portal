/**
 * AIVA feature flags. The first production release is PRIVATE, SUPER-ADMIN-ONLY and READ-ONLY.
 * Every action-producing capability defaults OFF and is enforced server-side.
 *
 * Read from env at call time so preview/prod can toggle without a rebuild where the platform
 * supports it. `bool(name, default)` treats only the exact string "true" as true.
 */

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return v === "true" || v === "1";
}

function int(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}

export const flags = {
  /** AIVA app reachable at all (private, super-admin only). */
  get enabled() {
    return bool("AIVA_ENABLED", true);
  },
  /** Hard read-only mode — no business-data mutations anywhere. Default TRUE. */
  get readOnly() {
    return bool("AIVA_READ_ONLY", true);
  },
  get brain3d() {
    return bool("AIVA_3D_BRAIN_ENABLED", true);
  },
  get websiteRecommendations() {
    return bool("AIVA_WEBSITE_RECOMMENDATIONS_ENABLED", false);
  },
  get campaigns() {
    return bool("AIVA_CAMPAIGNS_ENABLED", false);
  },
  get installmentReminders() {
    return bool("AIVA_INSTALLMENT_REMINDERS_ENABLED", false);
  },
  get localWorker() {
    return bool("AIVA_LOCAL_WORKER_ENABLED", false);
  },
  get openclaw() {
    return bool("AIVA_OPENCLAW_ENABLED", false);
  },
  /** Learning writes. OFF in v1 (no writes). */
  get learning() {
    return bool("AIVA_LEARNING_ENABLED", false);
  },
  get autoGreenActions() {
    return bool("AIVA_AUTO_GREEN_ACTIONS_ENABLED", false);
  },
  /** Optional: portal emits into business_events. OFF in v1 (portal hot paths untouched). */
  get emitEvents() {
    return bool("AIVA_EMIT_EVENTS", false);
  },
  get dataRetentionDays() {
    return int("AIVA_DATA_RETENTION_DAYS", 180);
  },
};

export type Risk = "green" | "amber" | "red";

/**
 * Whether an action of a given risk may EXECUTE right now. In v1 read-only mode all
 * mutating actions are blocked. Green read/draft actions are always allowed.
 */
export function canExecute(risk: Risk): { allowed: boolean; reason?: string } {
  if (risk === "green") return { allowed: true };
  if (flags.readOnly) return { allowed: false, reason: "AIVA is in read-only mode (AIVA_READ_ONLY=true)." };
  if (risk === "amber" && !flags.autoGreenActions) {
    return { allowed: false, reason: "Amber actions require approval and are disabled in this release." };
  }
  return { allowed: false, reason: "Action execution is disabled in the first release." };
}

/** Snapshot of all flags for the system-health / debug surfaces. */
export function flagSnapshot(): Record<string, boolean | number> {
  return {
    AIVA_ENABLED: flags.enabled,
    AIVA_READ_ONLY: flags.readOnly,
    AIVA_3D_BRAIN_ENABLED: flags.brain3d,
    AIVA_WEBSITE_RECOMMENDATIONS_ENABLED: flags.websiteRecommendations,
    AIVA_CAMPAIGNS_ENABLED: flags.campaigns,
    AIVA_INSTALLMENT_REMINDERS_ENABLED: flags.installmentReminders,
    AIVA_LOCAL_WORKER_ENABLED: flags.localWorker,
    AIVA_OPENCLAW_ENABLED: flags.openclaw,
    AIVA_LEARNING_ENABLED: flags.learning,
    AIVA_AUTO_GREEN_ACTIONS_ENABLED: flags.autoGreenActions,
    AIVA_EMIT_EVENTS: flags.emitEvents,
    AIVA_DATA_RETENTION_DAYS: flags.dataRetentionDays,
  };
}
