import { getBuyerSession } from "@/lib/session";
import { getPlanChangeNoticesForPhone } from "@/lib/dataProvider";
import { deriveEnrollment } from "@/lib/installments";
import PaymentPlanNoticeModal, { type PlanChangeNotice } from "@/components/portal/PaymentPlanNoticeModal";

/**
 * Portal shell. On any portal page, if the signed-in student has an
 * unacknowledged payment-plan change, show the one-time premium notice. Purely
 * additive — children render exactly as before.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  let notice: PlanChangeNotice | null = null;
  try {
    const session = await getBuyerSession();
    if (session?.phone) {
      const pending = await getPlanChangeNoticesForPhone(session.phone);
      if (pending.length > 0) {
        const e = pending[0];
        const d = deriveEnrollment(e);
        notice = {
          enrollmentId: e.id,
          courseTitle: e.course_title,
          plan: e.payment_plan ?? null,
          previousPlan: e.previous_payment_plan ?? null,
          paid: d.paid,
          outstanding: d.remaining,
          nextAmount: d.nextPayable?.amount ?? null,
          nextDue: d.nextPayable?.due ?? null,
        };
      }
    }
  } catch { /* never block the portal on the notice */ }

  return (
    <>
      {children}
      {notice && <PaymentPlanNoticeModal notice={notice} />}
    </>
  );
}
