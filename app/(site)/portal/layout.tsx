import { getBuyerSession } from "@/lib/session";
import { getPlanChangeNoticesForPhone } from "@/lib/dataProvider";
import { deriveEnrollment } from "@/lib/installments";
import { getPrimaryAccessAwarenessForPhone } from "@/lib/accessAwarenessServer";
import { studentPopupEnabledForPhone } from "@/lib/installmentProofFlags";
import PaymentPlanNoticeModal, { type PlanChangeNotice } from "@/components/portal/PaymentPlanNoticeModal";
import PortalAccessChrome from "@/components/portal/PortalAccessChrome";
import AccessAwarenessBanner from "@/components/access/AccessAwarenessBanner";
import type { AccessAwarenessBanner as AccessBannerData } from "@/lib/accessAwareness";

/**
 * Portal shell. Flag-scoped phones: AccessNotice sticky bar (PortalAccessChrome).
 * Others: legacy Stage-4 AccessAwarenessBanner only — never both.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  let notice: PlanChangeNotice | null = null;
  let accessBanner: AccessBannerData | null = null;
  try {
    const session = await getBuyerSession();
    if (session?.phone) {
      const flagOn = await studentPopupEnabledForPhone(session.phone);
      const [pending, banner] = await Promise.all([
        getPlanChangeNoticesForPhone(session.phone),
        flagOn ? Promise.resolve(null) : getPrimaryAccessAwarenessForPhone(session.phone),
      ]);
      accessBanner = banner;
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

  const body = (
    <>
      {accessBanner && (
        <div className="container-wide pt-4">
          <AccessAwarenessBanner banner={accessBanner} compact />
        </div>
      )}
      {children}
      {notice && <PaymentPlanNoticeModal notice={notice} />}
    </>
  );

  // Always mount chrome for authenticated portal so prompt fetch + upload sheet work;
  // bar only renders when flag+prompt say so.
  return <PortalAccessChrome>{body}</PortalAccessChrome>;
}
