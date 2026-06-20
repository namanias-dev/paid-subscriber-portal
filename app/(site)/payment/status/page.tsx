import { Suspense } from "react";
import StatusClient from "./StatusClient";

export const metadata = {
  title: "Payment Status",
};

export default function PaymentStatusPage() {
  return (
    <Suspense fallback={<div className="container-wide section text-center text-muted">Loading…</div>}>
      <StatusClient />
    </Suspense>
  );
}
