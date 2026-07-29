import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { buildBulkAccessReminders } from "@/lib/sms/accessReminderService";
import { sendAccessReminderBatch } from "@/lib/sms/accessReminderSend";
import { buildFollowUpPreview, FOLLOW_UP_DELAY_MINUTES } from "@/lib/sms/installmentFollowUp";
import { listLogsByCampaign } from "@/lib/sms/store";
import { resolveRetryTargets, retryTargetsAreDisjoint } from "@/lib/sms/retryTargets";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
  ACCESS_MAX_BULK,
} from "@/lib/sms/accessReminderConstants";
import {
  remainingAccessDailyBudget,
  templateBreakdown,
  enrollmentNeedsCallSet,
  accessPhonesSentToday,
} from "@/lib/sms/accessBulkGuards";
import { normalizeIndianMobile } from "@/lib/phone";
import { getCourseEnrollmentById } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/** Bulk preview — never sends. */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.enrollmentIds) ? body.enrollmentIds.filter((x: unknown) => typeof x === "string") : [];
  if (!ids.length) {
    return NextResponse.json({ ok: false, error: "Select at least one student." }, { status: 400 });
  }

  const now = Date.now();
  const budget = await remainingAccessDailyBudget(now);
  const [preview, followUp, needsCall, phonesToday] = await Promise.all([
    buildBulkAccessReminders(ids),
    buildFollowUpPreview(),
    enrollmentNeedsCallSet(ids),
    accessPhonesSentToday(now),
  ]);

  // Annotate preview with bulk-only silencers so the confirm dialog is honest.
  const excludedByReason = { ...preview.excludedByReason };
  let wouldSend = 0;
  const annotated = [];
  for (const p of preview.previews) {
    if (!p.sendable) {
      annotated.push(p);
      continue;
    }
    if (budget.killSwitch) {
      excludedByReason.kill_switch = (excludedByReason.kill_switch || 0) + 1;
      annotated.push({ ...p, sendable: false, blockReason: "kill_switch" as const, blockDetail: "Kill switch is ON." });
      continue;
    }
    if (budget.quiet) {
      excludedByReason.quiet_hours = (excludedByReason.quiet_hours || 0) + 1;
      annotated.push({ ...p, sendable: false, blockReason: "quiet_hours" as const, blockDetail: "Quiet hours (outside 09:00–20:00 IST)." });
      continue;
    }
    if (needsCall.has(p.enrollmentId)) {
      excludedByReason.needs_call = (excludedByReason.needs_call || 0) + 1;
      annotated.push({ ...p, sendable: false, blockReason: "needs_call" as const, blockDetail: "Flagged for call — not bulk-selectable." });
      continue;
    }
    const e = await getCourseEnrollmentById(p.enrollmentId);
    const digits = e ? normalizeIndianMobile(e.phone).digits10 : null;
    if (digits && phonesToday.has(digits)) {
      excludedByReason.already_sent_today = (excludedByReason.already_sent_today || 0) + 1;
      annotated.push({ ...p, sendable: false, blockReason: "already_sent_today" as const, blockDetail: "Already received an access reminder today (IST)." });
      continue;
    }
    wouldSend++;
    annotated.push(p);
  }

  // Ceiling trim for the confirm count (send path enforces the same).
  let ceilingDropped = 0;
  if (wouldSend > budget.remaining) {
    ceilingDropped = wouldSend - budget.remaining;
    excludedByReason.daily_ceiling = (excludedByReason.daily_ceiling || 0) + ceilingDropped;
    wouldSend = budget.remaining;
  }

  const sendablePreviews = annotated.filter((p) => p.sendable).slice(0, budget.remaining);
  const templates = templateBreakdown(sendablePreviews);

  return NextResponse.json({
    ok: true,
    preview: {
      ...preview,
      previews: annotated,
      sendableCount: wouldSend,
      excludedCount: annotated.length - annotated.filter((p) => p.sendable).length + ceilingDropped,
      excludedByReason,
    },
    followUp,
    maxRecipients: ACCESS_MAX_BULK,
    guards: {
      killSwitch: budget.killSwitch,
      quietHours: budget.quiet,
      sentToday: budget.sentToday,
      ceiling: budget.ceiling,
      remaining: budget.remaining,
    },
    templateBreakdown: templates,
    liveNote: "These are live SMS to real students. Confirm only if you intend to send now.",
  });
}

/** Bulk send — jobId groups logs; retryOf repairs a prior campaign without re-texting reached students. */
export async function PUT(req: Request) {
  if (!(await requirePermission("send_sms"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const clientIds = Array.isArray(body.enrollmentIds) ? body.enrollmentIds.filter((x: unknown) => typeof x === "string") : [];
  const retryOf = typeof body.retryOf === "string" && body.retryOf.trim() ? body.retryOf.trim() : null;
  const jobId = typeof body.jobId === "string" && body.jobId.trim() ? body.jobId.trim() : null;

  if (!jobId) {
    return NextResponse.json({ ok: false, error: "A jobId is required so a replay cannot double-send." }, { status: 400 });
  }
  if (retryOf && clientIds.length) {
    return NextResponse.json(
      { ok: false, error: "A retry names a campaign, not recipients. Send either retryOf or enrollmentIds, never both." },
      { status: 400 },
    );
  }
  if (!retryOf && !clientIds.length) {
    return NextResponse.json({ ok: false, error: "Select at least one student." }, { status: 400 });
  }
  if (clientIds.length > ACCESS_MAX_BULK) {
    return NextResponse.json(
      { ok: false, error: `A single job is capped at ${ACCESS_MAX_BULK} recipients; ${clientIds.length} were selected.` },
      { status: 400 },
    );
  }

  const prior = await listLogsByCampaign(jobId).catch(() => []);
  if (prior.length) {
    const sent = prior.filter((l) => ["SENT", "DELIVERED", "QUEUED"].includes(l.status)).length;
    return NextResponse.json({
      ok: true, replay: true, jobId, requested: prior.length, sent,
      failed: prior.length - sent, skipped: {}, followUpsScheduled: 0,
      followUpDelayMinutes: FOLLOW_UP_DELAY_MINUTES,
      note: "This job already ran — returning prior outcome.",
    });
  }

  let rawIds = clientIds;
  let retrySummary: { of: string; targets: number; reached: number; skipped: Record<string, number> } | null = null;
  if (retryOf) {
    const priorLogs = await listLogsByCampaign(retryOf).catch(() => []);
    if (!priorLogs.length) {
      return NextResponse.json({ ok: false, error: "That campaign has no logs, so there is nothing to retry." }, { status: 404 });
    }
    // Only step-1 access templates — never retry installment-instructions follow-ups.
    const accessLogs = priorLogs.filter(
      (l) => l.template_id === ACCESS_BLOCKED_TEMPLATE_ID || l.template_id === ACCESS_EXPIRING_TEMPLATE_ID,
    );
    const targets = resolveRetryTargets(accessLogs);
    if (!retryTargetsAreDisjoint(targets)) {
      return NextResponse.json(
        { ok: false, error: "Refusing to retry: the target set overlaps recipients the campaign already reached." },
        { status: 500 },
      );
    }
    if (!targets.enrollmentIds.length) {
      return NextResponse.json({
        ok: true, replay: false, jobId, requested: 0, sent: 0, failed: 0, skipped: targets.skipped,
        note: "Every recipient in that campaign was reached. Nothing to retry.",
      });
    }
    rawIds = targets.enrollmentIds;
    retrySummary = {
      of: retryOf,
      targets: targets.enrollmentIds.length,
      reached: targets.reachedEnrollmentIds.length,
      skipped: targets.skipped,
    };
  }

  const result = await sendAccessReminderBatch({
    enrollmentIds: rawIds,
    jobId,
    actorUserId: await currentAdminId(),
    allowRecentOverride: false,
  });

  if (!result.ok) {
    return NextResponse.json({
      ok: false, error: result.detail, kind: result.kind,
      blockReason: result.reason, excludedByReason: result.excludedByReason,
    }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    replay: false,
    jobId,
    requested: result.requested,
    sent: result.sent,
    failed: result.failed,
    skipped: result.skipped,
    excludedByReason: result.excludedByReason,
    followUpsScheduled: result.followUpsScheduled,
    followUpDelayMinutes: FOLLOW_UP_DELAY_MINUTES,
    mode: result.mode,
    balance: result.balance,
    retryOf: retrySummary,
    templateBreakdown: templateBreakdown(result.sendablePreviews),
  });
}
