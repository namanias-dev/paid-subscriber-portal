import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getBuyerSession } from "@/lib/session";
import { getCourseEnrollmentById, getReceiptsByPhone } from "@/lib/dataProvider";
import CoursePaymentsPanel from "@/components/portal/CoursePaymentsPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Course payments", robots: { index: false, follow: false } };

export default async function PortalCoursePage({ params }: { params: { id: string } }) {
  const session = await getBuyerSession();
  if (!session) redirect(`/portal/login?next=${encodeURIComponent(`/portal/course/${params.id}`)}`);

  const enrollment = await getCourseEnrollmentById(params.id);
  if (!enrollment || enrollment.phone.trim() !== session.phone.trim()) {
    return (
      <div className="container-wide section">
        <div className="mx-auto max-w-lg card p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-2xl text-danger">🔒</div>
          <h1 className="text-2xl font-bold">Enrollment not found</h1>
          <p className="mt-2 text-sm text-ink2">This course isn&apos;t on your account.</p>
          <Link href="/portal" className="btn btn-primary mt-5">← Back to my portal</Link>
        </div>
      </div>
    );
  }

  const allReceipts = await getReceiptsByPhone(session.phone);
  const receipts = allReceipts.filter((r) => r.enrollment_id === enrollment.id);
  const classHubHref = enrollment.amount_paid > 0 ? `/portal/class/${enrollment.course_id}` : null;

  return (
    <div className="container-wide section">
      <Link href="/portal" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
        <ArrowLeft size={16} /> Back to my portal
      </Link>
      <div className="mx-auto mt-4 max-w-2xl">
        <CoursePaymentsPanel enrollment={enrollment} receipts={receipts} classHubHref={classHubHref} />
      </div>
    </div>
  );
}
