import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getBuyerSession } from "@/lib/session";
import { getReceiptByNo, getSiteSettings } from "@/lib/dataProvider";
import ReceiptView from "@/components/public/ReceiptView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment Receipt", robots: { index: false, follow: false } };

export default async function ReceiptPage({ params }: { params: { receiptNo: string } }) {
  const session = await getBuyerSession();
  const receiptNo = decodeURIComponent(params.receiptNo || "");
  if (!session) redirect(`/portal/login?next=${encodeURIComponent(`/portal/receipt/${receiptNo}`)}`);

  const receipt = await getReceiptByNo(receiptNo);
  // Entitlement: receipt must belong to the signed-in buyer's phone.
  if (!receipt || receipt.phone.trim() !== session.phone.trim()) {
    return (
      <div className="container-wide section">
        <div className="mx-auto max-w-lg card p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-2xl text-danger">🔒</div>
          <h1 className="text-2xl font-bold">Receipt not found</h1>
          <p className="mt-2 text-sm text-ink2">This receipt isn&apos;t available on your account.</p>
          <Link href="/portal" className="btn btn-primary mt-5">← Back to my portal</Link>
        </div>
      </div>
    );
  }

  const { brand, logo_url, logo_alt } = await getSiteSettings();
  const contact = {
    name: brand.name || "Naman Sharma IAS Academy",
    address: brand.address || "",
    phone: brand.support_phone || "",
    email: brand.support_email || "",
    whatsapp: brand.whatsapp || brand.support_phone || "",
    logoUrl: logo_url || null,
    logoAlt: logo_alt || brand.name || "Naman Sharma IAS Academy",
  };

  return <ReceiptView receipt={receipt} contact={contact} />;
}
