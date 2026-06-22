import { Suspense } from "react";
import StatusClient from "./StatusClient";
import { getSiteSettings } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Payment Status",
};

export default async function PaymentStatusPage() {
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

  return (
    <Suspense fallback={<div className="container-wide section text-center text-muted">Loading…</div>}>
      <StatusClient contact={contact} />
    </Suspense>
  );
}
