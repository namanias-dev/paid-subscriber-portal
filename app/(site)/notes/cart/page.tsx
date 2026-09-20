import CartClient from "@/components/notes/CartClient";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata = { title: "Cart — Naman IAS Notes" };

export default function CartPage() {
  noStore();
  return (
    <div className="container-wide py-10">
      <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Notes Store</p>
      <h1 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">Cart</h1>
      <p className="mt-2 text-sm text-[var(--ca-navy)]/55">Physical notes. Prices are server-quoted. Shipping is calculated from your PIN at checkout.</p>
      <CartClient />
    </div>
  );
}
