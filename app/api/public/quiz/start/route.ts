import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getQuizBySlug, getQuizQuestions, getAttemptsByQuiz, getAnswersByAttempt,
  addAttempt, addLead, getEnrollments, getSiteSettings,
} from "@/lib/dataProvider";
import { getStudentSession } from "@/lib/session";
import { checkQuizAccess } from "@/lib/quizAccess";
import { getStudentById } from "@/lib/dataProvider";
import { studentAccessActive } from "@/lib/studentAccess";
import { attemptExpiry, buildOrder, clientQuestions, isAttemptExpired } from "@/lib/quizEngine";
import { normalizeIndianMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "quiz_guest";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body.slug || "");
    const quiz = await getQuizBySlug(slug);
    if (!quiz) return NextResponse.json({ ok: false, error: "Quiz not found" }, { status: 404 });

    const session = await getStudentSession();
    const enrollments = session ? await getEnrollments(session.student_id) : [];
    // DB-fresh access (so revoked/expired students can't start gated tests on a still-valid JWT).
    const liveStudent = session ? await getStudentById(session.student_id) : null;
    const liveActive = liveStudent ? studentAccessActive(liveStudent) : undefined;
    const access = checkQuizAccess(quiz, session, enrollments, liveActive);
    if (!access.ok) return NextResponse.json({ ok: false, reason: access.reason, error: access.message || "Access denied" }, { status: 403 });

    const quizQuestions = await getQuizQuestions(quiz.id);
    if (quizQuestions.length === 0) return NextResponse.json({ ok: false, error: "This quiz has no questions yet." }, { status: 400 });

    const jar = cookies();
    let guestId = jar.get(GUEST_COOKIE)?.value || null;
    const isGuest = !session;
    if (isGuest && !guestId) guestId = `g_${crypto.randomUUID()}`;

    const allAttempts = await getAttemptsByQuiz(quiz.id);
    const mine = allAttempts.filter((a) => (session ? a.user_id === session.student_id : a.guest_session_id === guestId));

    // Resume an in-progress, non-expired attempt if allowed.
    const resumable = mine.find((a) => a.status === "IN_PROGRESS" && !isAttemptExpired(a));
    if (resumable && quiz.timing_settings?.resume_allowed !== false) {
      const order = (resumable.result_summary?.order as string[]) || buildOrder(quizQuestions, false);
      const answers = await getAnswersByAttempt(resumable.id);
      const res = NextResponse.json({
        ok: true,
        attemptId: resumable.id,
        resumed: true,
        expiresAt: resumable.expires_at,
        showTimer: quiz.timing_settings?.show_timer !== false,
        oneAtATime: quiz.attempt_settings?.one_at_a_time === true,
        questions: clientQuestions(quizQuestions, order),
        savedAnswers: answers.map((a) => ({ question_id: a.question_id, selected_option: a.selected_option, marked_for_review: a.marked_for_review })),
      });
      if (guestId) res.cookies.set(GUEST_COOKIE, guestId, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
      return res;
    }

    // Max attempts guard.
    const finished = mine.filter((a) => a.status !== "IN_PROGRESS");
    if (quiz.max_attempts && finished.length >= quiz.max_attempts && quiz.attempt_settings?.retry_allowed === false) {
      return NextResponse.json({ ok: false, reason: "maxed", error: "You have reached the maximum number of attempts." }, { status: 403 });
    }

    // Optional lead capture for guests.
    const guest = (body.guest || {}) as { name?: string; email?: string; mobile?: string; interest?: string };
    const norm = guest.mobile ? normalizeIndianMobile(guest.mobile) : null;
    const guestMobile = norm?.ok ? norm.digits10! : null;

    // The lead gate is required when the global setting is ON (default) OR the per-quiz flag is set.
    const settings = await getSiteSettings();
    const requireLead =
      settings.content.quiz_lead_gate !== false ||
      quiz.result_settings?.capture_lead_before_result === true;

    // When lead capture is required, enforce valid name + mobile server-side.
    if (isGuest && requireLead) {
      if (!guest.name || guest.name.trim().length < 2 || !guestMobile) {
        return NextResponse.json(
          { ok: false, reason: "invalid_lead", error: "Please enter your name and a valid 10-digit mobile number." },
          { status: 400 },
        );
      }
    }
    if (isGuest && guest.name && guestMobile) {
      try {
        await addLead({
          name: guest.name, phone: guestMobile,
          source: "quiz_public",
          course_interest: guest.interest || quiz.title || quiz.subject || "Quiz",
          campaign: "quiz",
          ...(guest.email ? { email: guest.email } as Record<string, string> : {}),
        });
      } catch { /* non-fatal */ }
    }

    const startedAt = new Date().toISOString();
    const order = buildOrder(quizQuestions, quiz.attempt_settings?.randomize_question_order === true);
    const attempt = await addAttempt({
      quiz_id: quiz.id,
      user_id: session?.student_id ?? null,
      guest_session_id: isGuest ? guestId : null,
      guest_name: isGuest ? guest.name ?? null : null,
      guest_email: isGuest ? guest.email ?? null : null,
      guest_mobile: isGuest ? guestMobile : null,
      status: "IN_PROGRESS",
      started_at: startedAt,
      expires_at: attemptExpiry(quiz, startedAt),
      result_summary: { order },
    });

    const res = NextResponse.json({
      ok: true,
      attemptId: attempt.id,
      resumed: false,
      expiresAt: attempt.expires_at,
      showTimer: quiz.timing_settings?.show_timer !== false,
      oneAtATime: quiz.attempt_settings?.one_at_a_time === true,
      questions: clientQuestions(quizQuestions, order, quiz.attempt_settings?.randomize_option_order === true),
      savedAnswers: [],
    });
    if (guestId) res.cookies.set(GUEST_COOKIE, guestId, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to start quiz.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
