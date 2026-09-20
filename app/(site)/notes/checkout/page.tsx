import CheckoutForm from "@/components/notes/CheckoutForm";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata = { title: "Checkout — Naman IAS Notes" };

export default function CheckoutPage() {
  noStore();
  return (
    <div className="container-wide py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Cart → Address → Secure payment</p>
      <h1 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">Checkout</h1>
      <p className="mt-2 text-sm text-[var(--ca-navy)]/60">Guest checkout. No account. You will be sent to ICICI Eazypay to pay, then back here.</p>
      <CheckoutForm />
    </div>
  );
}
