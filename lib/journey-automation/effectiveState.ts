/**
 * EFFECTIVE journey state — the HONEST answer to "is this journey actually doing
 * anything right now?". PURE + client-safe (no server imports), so the dashboard,
 * builder toolbar and tests all derive the exact same label from the same inputs.
 *
 * `execution_mode` alone is misleading: a workflow can read "Live" while the
 * server engine is OFF (JOURNEY_AUTOMATION_EXECUTION_ENABLED unset, or no
 * CRON_SECRET/scheduler wired), so NOTHING enrolls or sends. This resolves the
 * real state = f(execution_mode, server flags, kill switch, category pause) and
 * never lets a user believe they are live when they are not.
 *
 * Nothing here enables sending — it only DESCRIBES the current gates.
 */

export type ExecutionMode = "off" | "simulate" | "live";

/** Visual tone buckets (map to pill colours in the UI). */
export type EffectiveTone = "off" | "sim" | "live" | "warn" | "halted";

export interface EffectiveStateInput {
  mode: ExecutionMode;
  /** JOURNEY_AUTOMATION_EXECUTION_ENABLED — the engine master gate. */
  executionEnabled: boolean;
  /** JOURNEY_AUTOMATION_SMS_ENABLED — the send gate (live mode still simulates without it). */
  smsEnabled: boolean;
  /** Global kill switch. */
  killSwitchEngaged: boolean;
  /** Optional: a category this workflow relies on is globally paused. */
  categoryPaused?: boolean;
}

export interface EffectiveState {
  /** Short, unmistakable label for a pill. */
  label: string;
  tone: EffectiveTone;
  /** Whether the engine will actually process this workflow right now. */
  running: boolean;
  /** Whether a real SMS can be sent right now. */
  sending: boolean;
  /** Plain-English tooltip explaining the state + what to do next. */
  detail: string;
}

const RUNBOOK = "See the go-live runbook (docs/reports/journey-automation-go-live-runbook.md).";

/**
 * Resolve the effective state. Order matters: kill switch > off > engine-off >
 * category pause > running (simulate / live-sms-off / live-sending).
 */
export function effectiveJourneyState(input: EffectiveStateInput): EffectiveState {
  const { mode, executionEnabled, smsEnabled, killSwitchEngaged, categoryPaused } = input;

  if (killSwitchEngaged) {
    return {
      label: "Halted (kill switch)",
      tone: "halted",
      running: false,
      sending: false,
      detail: "The global kill switch is engaged: the engine processes nothing and no SMS can be sent. Clear the kill switch to resume.",
    };
  }

  if (mode === "off") {
    return {
      label: "Off",
      tone: "off",
      running: false,
      sending: false,
      detail: "This journey is Off — nobody enrolls and nothing runs. Set it to Simulate to dry-run, or Live to run for real (once the engine is enabled).",
    };
  }

  // Set to simulate/live but the engine master gate is OFF → nothing happens.
  if (!executionEnabled) {
    const base = mode === "live" ? "Live" : "Simulate";
    return {
      label: `${base} (engine OFF — not running)`,
      tone: "warn",
      running: false,
      sending: false,
      detail: `This journey is set to ${base}, but the execution engine is OFF, so nothing enrolls, runs or sends. Turn on JOURNEY_AUTOMATION_EXECUTION_ENABLED and point a scheduler at /api/cron/journey-engine with CRON_SECRET. ${RUNBOOK}`,
    };
  }

  if (categoryPaused) {
    return {
      label: `${mode === "live" ? "Live" : "Simulate"} (category paused)`,
      tone: "warn",
      running: true,
      sending: false,
      detail: "The engine is running, but a message category this journey uses is paused, so those steps are suppressed. Resume the category to let it act.",
    };
  }

  if (mode === "simulate") {
    return {
      label: "Simulate (running)",
      tone: "sim",
      running: true,
      sending: false,
      detail: "The engine is evaluating real events and recording what it WOULD send — but it sends nothing. This is the safe dry-run mode.",
    };
  }

  // mode === "live" and engine on.
  if (!smsEnabled) {
    return {
      label: "Live (SMS OFF — simulating)",
      tone: "warn",
      running: true,
      sending: false,
      detail: `The engine runs, but SMS sending is OFF, so live steps still only simulate. Turn on JOURNEY_AUTOMATION_SMS_ENABLED (and the category flag) to actually send. ${RUNBOOK}`,
    };
  }

  return {
    label: "Live (sending)",
    tone: "live",
    running: true,
    sending: true,
    detail: "Fully live: the engine is running and matching steps can send real SMS to real contacts.",
  };
}

/** Map a tone to the shared pill class used across admin tables. */
export function effectiveTonePill(tone: EffectiveTone): string {
  switch (tone) {
    case "live": return "pill-green";
    case "sim": return "pill-blue";
    case "warn": return "pill-amber";
    case "halted": return "pill-red";
    default: return "pill-gray";
  }
}
