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
      <h1 className="font-heading text-3xl font-bold text-[var(--ca-navy)]">Cart</h1>
      <CartClient />
    </div>
  );
}
