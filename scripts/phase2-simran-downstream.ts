/**
 * Print Simran downstream would-generate surfaces (send nothing).
 */
import { readFileSync, existsSync } from "fs";
import { getCourseEnrollmentById, getAllCourses } from "../lib/dataProvider";
import { enrollmentFeeStateFromEnrollment } from "../lib/enrollmentFeeState";
import { nextUnpaidDatedLine, daysOverdueFromSchedule, outstandingAmount } from "../lib/accessAtRisk";
import { lectureAccessForCourse } from "../lib/entitlements";
import { evaluateEnrollmentForBackfill } from "../lib/sms/installmentLadder";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1]!.trim();
    let v = m[2]!.trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const ID = "c5a9042c-d157-4afe-8c11-e71c92a5e036";

async function main() {
  const enr = await getCourseEnrollmentById(ID);
  if (!enr) throw new Error("missing");
  const fee = enrollmentFeeStateFromEnrollment(enr);
  const next = nextUnpaidDatedLine(enr.schedule);
  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === enr.course_id);
  const live = lectureAccessForCourse(course, enr, undefined, false);
  const ladder = course
    ? evaluateEnrollmentForBackfill({
        enrollment: enr,
        course,
        loginCode: null,
        lastContactAt: null,
        excludeReason: null,
      })
    : null;

  console.log(
    JSON.stringify(
      {
        fee: {
          netPaid: fee.netPaid,
          outstanding: fee.outstanding,
          progressPct: fee.progressPct,
          nextDue: fee.nextDueInstalment,
          hasOverdue: fee.hasOverdue,
          inst1: fee.instalments.find((l) => l.no === 2),
        },
        nextUnpaidDatedLine: next
          ? { no: next.no, amount: next.amount, due: next.due, label: next.label }
          : null,
        daysOverdue: daysOverdueFromSchedule(enr),
        outstandingAmount: outstandingAmount(enr),
        lectureAccess: { status: live.status, reason: live.reason },
        ladderWould: ladder
          ? { channel: ladder.proposedChannel, message: ladder.proposedMessage, pct: fee.progressPct }
          : null,
        portalBanner: {
          partial: fee.instalments.find((l) => l.no === 2)?.status === "partially_paid",
          carryForward: fee.nextDueInstalment?.carriedIn || 0,
          nextDueAmount: fee.nextDueInstalment?.amountDue,
          nextDueDate: fee.nextDueInstalment?.dueDate,
        },
        sms: "No existing DLT template fits partial+carry — portal + Telegram only. Create nothing, send nothing.",
        telegramPartialWould: {
          amountPaid: 18000,
          shortfallCarried: fee.instalments.find((l) => l.no === 2)?.carriedOut || 0,
          nextAmount: fee.nextDueInstalment?.amountDue,
          nextDue: fee.nextDueInstalment?.dueDate,
          phone: enr.phone,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
