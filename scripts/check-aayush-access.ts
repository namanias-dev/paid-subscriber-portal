import { getCourseEnrollmentById, paidCourseIdsForPhone, getAllCourses, getCourseEnrollmentsByPhone, getBuyers } from "../lib/dataProvider";
import { canAccessLecture, lectureAccessForCourse } from "../lib/entitlements";
import { earliestUnpaidDue, isActiveEnrollment } from "../lib/installments";

async function main() {
  const phone = "6284046155";
  const enr = await getCourseEnrollmentById("ea15e864-e8c4-4f34-a772-7e7daae54182");
  if (!enr) throw new Error("no enrollment");
  const courses = await getAllCourses();
  const course = courses.find((c) => c.id === enr.course_id) || null;
  const unpaid = earliestUnpaidDue(enr);
  const access = lectureAccessForCourse(
    { phone, courseIds: [enr.course_id], buyerId: null, isStaff: false },
    enr.course_id,
    { courses, enrollments: [enr], overrides: [] },
  );
  const paidIds = await paidCourseIdsForPhone(phone);
  console.log(
    JSON.stringify(
      {
        status: enr.status,
        amount_paid: enr.amount_paid,
        total_fee: enr.total_fee,
        isActive: isActiveEnrollment(enr),
        unpaid,
        access,
        paidCourseIds: paidIds,
        now: new Date().toISOString(),
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
