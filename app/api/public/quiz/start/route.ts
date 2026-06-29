import { NextResponse } from "next/server";
import {
  getQuizBySlug, getQuizQuestions, getAttemptsByQuiz, getAnswersByAttempt,
  addAttempt, getAllCourses, ensureStudentForCustomer,
} from "@/lib/dataProvider";
import { resolveLearner, gateQuiz } from "@/lib/entitlements";
import { quizIsLive } from "@/lib/quizAccess";
import { attemptExpiry, buildOrder, clientQuestions, isAttemptExpired } from "@/lib/quizEngine";

export const dynamic = "force-dynamic";

/**
 * Start (or resume) a quiz attempt — AUTHENTICATED ONLY.
 *
 * Auth is enforced server-side on every request: a logged-out/unauthenticated
 * caller is rejected (never trusts client UI). New visitors are sent to the lead
 * form (`reason:"lead"`), which creates a real student account, logs them in,
 * then returns here. This guarantees EVERY attempt is tied to a known student —
 * no anonymous guest attempts are ever created.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body.slug || "");
    const quiz = await getQuizBySlug(slug);
    if (!quiz) return NextResponse.json({ ok: false, error: "Quiz not found" }, { status: 404 });

    if (!quizIsLive(quiz)) {
      return NextResponse.json({ ok: false, reason: "unavailable", error: "This quiz is not currently available." }, { status: 403 });
    }

    // CENTRAL entitlement check — server-side, never trusts client cache.
    const [learner, courses] = await Promise.all([resolveLearner(), getAllCourses()]);
    const gate = gateQuiz(quiz, learner, courses);
    if (!gate.allowed) {
      const msg =
        gate.reason === "login" ? "Please log in to take this test."
        : gate.reason === "expired" ? "Your access has expired. Renew to continue."
        : "This is a premium test. Enrol in a course that unlocks it.";
      return NextResponse.json(
        { ok: false, reason: gate.reason, error: msg, unlockCourseIds: gate.unlockCourseIds },
        { status: 403 },
      );
    }

    // HARD AUTH GATE: even for a free quiz that "allows" everyone, the taker must
    // be a known, logged-in learner. Anonymous → lead form (which logs them in),
    // so the attempt is always attributable to a student. No guest attempts.
    if (!learner) {
      return NextResponse.json(
        { ok: false, reason: "lead", needsLead: true, error: "Please enter your details to take this test." },
        { status: 401 },
      );
    }

    const quizQuestions = await getQuizQuestions(quiz.id);
    if (quizQuestions.length === 0) return NextResponse.json({ ok: false, error: "This quiz has no questions yet." }, { status: 400 });

    // Resolve the canonical student id for attempt ownership. An entitled buyer
    // without a student row yet gets one created/linked (deduped by phone).
    let userId = learner.studentId ?? null;
    if (!userId) {
      const created = await ensureStudentForCustomer(learner.phone, learner.name).catch(() => null);
      userId = created?.id ?? null;
    }
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Could not load your profile. Please log in again." }, { status: 401 });
    }

    const allAttempts = await getAttemptsByQuiz(quiz.id);
    const mine = allAttempts.filter((a) => a.user_id === userId);

    // Resume an in-progress, non-expired attempt if allowed.
    const resumable = mine.find((a) => a.status === "IN_PROGRESS" && !isAttemptExpired(a));
    if (resumable && quiz.timing_settings?.resume_allowed !== false) {
      const order = (resumable.result_summary?.order as string[]) || buildOrder(quizQuestions, false);
      const answers = await getAnswersByAttempt(resumable.id);
      return NextResponse.json({
        ok: true,
        attemptId: resumable.id,
        resumed: true,
        expiresAt: resumable.expires_at,
        showTimer: quiz.timing_settings?.show_timer !== false,
        oneAtATime: quiz.attempt_settings?.one_at_a_time === true,
        questions: clientQuestions(quizQuestions, order),
        savedAnswers: answers.map((a) => ({ question_id: a.question_id, selected_option: a.selected_option, marked_for_review: a.marked_for_review })),
      });
    }

    // Max attempts guard.
    const finished = mine.filter((a) => a.status !== "IN_PROGRESS");
    if (quiz.max_attempts && finished.length >= quiz.max_attempts && quiz.attempt_settings?.retry_allowed === false) {
      return NextResponse.json({ ok: false, reason: "maxed", error: "You have reached the maximum number of attempts." }, { status: 403 });
    }

    const startedAt = new Date().toISOString();
    const order = buildOrder(quizQuestions, quiz.attempt_settings?.randomize_question_order === true);
    const attempt = await addAttempt({
      quiz_id: quiz.id,
      user_id: userId,
      status: "IN_PROGRESS",
      started_at: startedAt,
      expires_at: attemptExpiry(quiz, startedAt),
      result_summary: { order },
    });

    return NextResponse.json({
      ok: true,
      attemptId: attempt.id,
      resumed: false,
      showTimer: quiz.timing_settings?.show_timer !== false,
      oneAtATime: quiz.attempt_settings?.one_at_a_time === true,
      expiresAt: attempt.expires_at,
      questions: clientQuestions(quizQuestions, order, quiz.attempt_settings?.randomize_option_order === true),
      savedAnswers: [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to start quiz.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
